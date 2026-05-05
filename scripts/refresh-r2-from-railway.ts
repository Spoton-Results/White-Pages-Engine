import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "crypto";
import { pool } from "../server/db";

type Args = {
  websiteId?: string;
  slug?: string;
  limit: number;
  batch: number;
  dryRun: boolean;
  onlyPlain: boolean;
};

type PageRow = {
  id: string;
  slug: string;
  r2_key: string | null;
};

type WebsiteRow = {
  id: string;
  domain: string;
  name: string;
  r2_prefix: string | null;
};

function parseArgs(): Args {
  const args: Args = { limit: 100, batch: 25, dryRun: false, onlyPlain: false };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "websiteId") args.websiteId = value;
    if (key === "slug") args.slug = value;
    if (key === "limit") args.limit = Math.max(1, Number(value || 100));
    if (key === "batch") args.batch = Math.max(1, Number(value || 25));
    if (key === "dryRun") args.dryRun = value !== "false";
    if (key === "onlyPlain") args.onlyPlain = value !== "false";
  }
  if (!args.websiteId) throw new Error("Missing required --websiteId=<id>");
  return args;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function hashContent(html: string): string {
  return createHash("sha256").update(html).digest("hex");
}

async function getWebsite(websiteId: string): Promise<WebsiteRow> {
  const res = await pool.query(
    `SELECT id, domain, name, r2_prefix
     FROM websites
     WHERE id = $1::text`,
    [websiteId],
  );
  if (!res.rows[0]) throw new Error(`Website not found: ${websiteId}`);
  return res.rows[0];
}

async function getExistingKeyPattern(websiteId: string): Promise<{ sampleSlug: string; sampleKey: string } | null> {
  const res = await pool.query(
    `SELECT slug, r2_key
     FROM pages
     WHERE website_id = $1::text
       AND r2_key IS NOT NULL
       AND r2_key <> ''
     ORDER BY rendered_at DESC NULLS LAST
     LIMIT 1`,
    [websiteId],
  );
  const row = res.rows[0];
  return row ? { sampleSlug: row.slug, sampleKey: row.r2_key } : null;
}

function deriveR2Key(page: PageRow, website: WebsiteRow, pattern: { sampleSlug: string; sampleKey: string } | null): string {
  if (page.r2_key) return page.r2_key;
  if (pattern && pattern.sampleKey.includes(pattern.sampleSlug)) {
    return pattern.sampleKey.replace(pattern.sampleSlug, page.slug);
  }
  const prefix = (website.r2_prefix || `pages/${website.id}`).replace(/^\/+|\/+$/g, "");
  return `${prefix}/${page.slug}.html`;
}

async function getTargets(websiteId: string, slug: string | undefined, limit: number): Promise<PageRow[]> {
  if (slug) {
    const res = await pool.query(
      `SELECT id, slug, r2_key
       FROM pages
       WHERE website_id = $1::text
         AND slug = $2::text
         AND status = 'published'
       LIMIT 1`,
      [websiteId, slug],
    );
    return res.rows;
  }

  const res = await pool.query(
    `SELECT id, slug, r2_key
     FROM pages
     WHERE website_id = $1::text
       AND status = 'published'
       AND COALESCE(noindex, false) = false
     ORDER BY updated_at DESC, id ASC
     LIMIT $2::int`,
    [websiteId, limit],
  );
  return res.rows;
}

function looksPlainOrUnwrapped(html: string): boolean {
  const lower = html.toLowerCase();
  const hasFullShell = lower.includes("<!doctype html") || lower.includes("<html");
  const hasNexusShell = lower.includes("powered by nexus pages") || lower.includes("spoton results") || lower.includes("x-nexus");
  const hasStyle = lower.includes("<style") || lower.includes("stylesheet") || lower.includes("class=");
  return !hasFullShell || (!hasNexusShell && !hasStyle);
}

async function fetchRailwayHtml(origin: string, domain: string, slug: string): Promise<string> {
  const url = `${origin.replace(/\/+$/, "")}/sites/${domain}/${slug}`;
  const res = await fetch(url, { redirect: "manual" });
  if (!res.ok) throw new Error(`Railway fetch failed ${res.status} ${res.statusText} for ${url}`);
  const html = await res.text();
  if (!html || html.trim().length < 500) throw new Error(`Railway returned too-short HTML for ${slug}`);
  return html;
}

async function getStats(websiteId: string) {
  const res = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false)::int AS published_indexable,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND r2_key IS NOT NULL)::int AS has_r2_key,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND content_hash IS NOT NULL)::int AS has_content_hash,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND rendered_at IS NOT NULL)::int AS has_rendered_at
     FROM pages
     WHERE website_id = $1::text`,
    [websiteId],
  );
  return res.rows[0];
}

async function main() {
  const args = parseArgs();
  const websiteId = args.websiteId!;

  if (process.env.R2_RENDERING_ENABLED !== "true") {
    throw new Error("R2_RENDERING_ENABLED must be true");
  }

  const accountId = requiredEnv("R2_ACCOUNT_ID");
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");
  const bucket = requiredEnv("R2_BUCKET_NAME");
  const origin = process.env.NEXUS_ORIGIN || "https://admin.spotonnexus.com";

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const website = await getWebsite(websiteId);
  const pattern = await getExistingKeyPattern(websiteId);
  const targets = await getTargets(websiteId, args.slug, args.limit);

  console.log(`[r2-refresh-railway] Starting website=${websiteId} domain=${website.domain}`);
  console.log(`[r2-refresh-railway] Options: slug=${args.slug || "none"} limit=${args.limit} dryRun=${args.dryRun} onlyPlain=${args.onlyPlain}`);
  console.log(`[r2-refresh-railway] Existing key pattern: ${pattern ? `${pattern.sampleKey} from ${pattern.sampleSlug}` : "none"}`);
  console.log("[r2-refresh-railway] Before:", await getStats(websiteId));
  console.log(`[r2-refresh-railway] Found ${targets.length} target page(s)`);

  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  for (const page of targets) {
    try {
      const html = await fetchRailwayHtml(origin, website.domain, page.slug);
      const plain = looksPlainOrUnwrapped(html);
      if (args.onlyPlain && !plain) {
        skipped++;
        console.log(`[r2-refresh-railway] skipped styled railway html: ${page.slug}`);
        continue;
      }

      const contentHash = hashContent(html);
      const key = deriveR2Key(page, website, pattern);

      if (!args.dryRun) {
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: html,
          ContentType: "text/html; charset=utf-8",
          CacheControl: "public, max-age=60, s-maxage=86400, stale-while-revalidate=60",
          Metadata: {
            websiteId,
            pageId: page.id,
            slug: page.slug,
            contentHash,
            source: "railway-rendered-html",
          },
        }));

        await pool.query(
          `UPDATE pages
           SET r2_key = $1::text,
               content_hash = $2::text,
               rendered_at = NOW(),
               updated_at = NOW()
           WHERE id = $3::text
             AND website_id = $4::text`,
          [key, contentHash, page.id, websiteId],
        );
      }

      refreshed++;
      console.log(`[r2-refresh-railway] refreshed ${refreshed}: ${page.slug} -> ${key} bytes=${html.length}`);
    } catch (err: any) {
      failed++;
      console.error(`[r2-refresh-railway] failed ${page.id} ${page.slug}:`, err?.message || err);
    }
  }

  console.log("[r2-refresh-railway] After:", await getStats(websiteId));
  console.log(`[r2-refresh-railway] Done. refreshed=${refreshed} skipped=${skipped} failed=${failed} dryRun=${args.dryRun}`);
}

main()
  .catch((err) => {
    console.error("[r2-refresh-railway] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
