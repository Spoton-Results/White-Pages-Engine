import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "crypto";
import { pool } from "../server/db";

type Args = {
  websiteId?: string;
  limit: number;
  dryRun: boolean;
};

type PageRow = {
  id: string;
  slug: string;
  title: string;
  h1: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  page_type: string;
  content_html: string;
};

type WebsiteRow = {
  id: string;
  domain: string;
  name: string;
  custom_head: string | null;
  r2_prefix: string | null;
  settings: any;
};

function parseArgs(): Args {
  const args: Args = { limit: 100, dryRun: false };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "websiteId") args.websiteId = value;
    if (key === "limit") args.limit = Math.max(1, Number(value || 100));
    if (key === "dryRun") args.dryRun = value !== "false";
  }
  if (!args.websiteId) throw new Error("Missing required --websiteId=<id>");
  return args;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hashContent(html: string): string {
  return createHash("sha256").update(html).digest("hex");
}

function normalizeBaseUrl(website: WebsiteRow): string {
  const parentDomain = website.settings?.parentDomain;
  const proxyPath = website.settings?.proxyPath && !String(website.settings.proxyPath).startsWith("/sites/")
    ? String(website.settings.proxyPath)
    : "";
  if (parentDomain) return `https://${parentDomain}${proxyPath}`;
  return `https://${website.domain}`;
}

function buildHtml(page: PageRow, website: WebsiteRow): string {
  const baseUrl = normalizeBaseUrl(website);
  const canonical = page.canonical_url || `${baseUrl}/${page.slug}`;
  const title = page.title || page.h1 || page.slug;
  const h1 = page.h1 || page.title || page.slug;
  const meta = page.meta_description || `${title} from ${website.name || website.domain}.`;
  const customHead = website.custom_head || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(meta)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta name="robots" content="index,follow" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(meta)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  ${customHead}
  <style>
    body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f8fafc;color:#111827;line-height:1.65;}
    .page{max-width:980px;margin:0 auto;padding:48px 20px 72px;}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:34px;box-shadow:0 18px 60px rgba(15,23,42,.08);}
    h1{font-size:clamp(2rem,4vw,3.25rem);line-height:1.08;margin:0 0 18px;color:#0f172a;}
    h2{font-size:1.45rem;margin:32px 0 10px;color:#111827;}
    p{font-size:1.05rem;color:#374151;}
    a{color:#2563eb;}
    ul{padding-left:1.4rem;}
    li{margin:.4rem 0;}
    .eyebrow{text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:#2563eb;font-size:.78rem;margin-bottom:12px;}
  </style>
</head>
<body>
  <main class="page">
    <article class="card">
      <div class="eyebrow">${escapeHtml(page.page_type.replace(/_/g, " "))}</div>
      <h1>${escapeHtml(h1)}</h1>
      ${page.content_html}
    </article>
  </main>
</body>
</html>`;
}

async function getWebsite(websiteId: string): Promise<WebsiteRow> {
  const res = await pool.query(
    `SELECT id, domain, name, custom_head, r2_prefix, settings
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
  if (pattern && pattern.sampleKey.includes(pattern.sampleSlug)) {
    return pattern.sampleKey.replace(pattern.sampleSlug, page.slug);
  }
  const prefix = (website.r2_prefix || website.id).replace(/^\/+|\/+$/g, "");
  return `${prefix}/${page.slug}.html`;
}

async function getTargets(websiteId: string, limit: number): Promise<PageRow[]> {
  const res = await pool.query(
    `SELECT
       p.id,
       p.slug,
       p.title,
       p.h1,
       p.meta_description,
       p.canonical_url,
       p.page_type,
       pv.content_html
     FROM pages p
     INNER JOIN page_versions pv
       ON pv.page_id = p.id
      AND pv.is_active = true
     WHERE p.website_id = $1::text
       AND p.status = 'published'
       AND COALESCE(p.noindex, false) = false
       AND (p.r2_key IS NULL OR p.content_hash IS NULL OR p.rendered_at IS NULL)
       AND pv.content_html IS NOT NULL
       AND LENGTH(BTRIM(pv.content_html)) > 0
     ORDER BY p.created_at ASC, p.id ASC
     LIMIT $2::int`,
    [websiteId, limit],
  );
  return res.rows;
}

async function getStats(websiteId: string) {
  const res = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false)::int AS published_indexable,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND r2_key IS NOT NULL)::int AS has_r2_key,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND content_hash IS NOT NULL)::int AS has_content_hash,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND rendered_at IS NOT NULL)::int AS has_rendered_at,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND (r2_key IS NULL OR content_hash IS NULL OR rendered_at IS NULL))::int AS missing_static_metadata
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

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const website = await getWebsite(websiteId);
  const pattern = await getExistingKeyPattern(websiteId);
  const targets = await getTargets(websiteId, args.limit);

  console.log(`[r2-force-render] Starting website=${websiteId}`);
  console.log(`[r2-force-render] Options: limit=${args.limit} dryRun=${args.dryRun}`);
  console.log(`[r2-force-render] Existing key pattern: ${pattern ? `${pattern.sampleKey} from ${pattern.sampleSlug}` : "none"}`);
  console.log("[r2-force-render] Before:", await getStats(websiteId));
  console.log(`[r2-force-render] Found ${targets.length} target page(s)`);

  let rendered = 0;
  let failed = 0;

  for (const page of targets) {
    try {
      const html = buildHtml(page, website);
      const contentHash = hashContent(html);
      const key = deriveR2Key(page, website, pattern);

      if (!args.dryRun) {
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: html,
          ContentType: "text/html; charset=utf-8",
          CacheControl: "public, max-age=300, s-maxage=86400",
          Metadata: {
            websiteId,
            pageId: page.id,
            slug: page.slug,
            contentHash,
            forced: "true",
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

      rendered++;
      console.log(`[r2-force-render] rendered ${rendered}: ${page.slug} -> ${key}`);
    } catch (err: any) {
      failed++;
      console.error(`[r2-force-render] failed ${page.id} ${page.slug}:`, err?.message || err);
    }
  }

  console.log("[r2-force-render] After:", await getStats(websiteId));
  console.log(`[r2-force-render] Done. rendered=${rendered} failed=${failed} dryRun=${args.dryRun}`);
}

main()
  .catch((err) => {
    console.error("[r2-force-render] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
