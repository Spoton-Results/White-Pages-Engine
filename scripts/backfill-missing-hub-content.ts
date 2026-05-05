import { pool } from "../server/db";

type Args = {
  websiteId?: string;
  batch: number;
  limit: number;
  dryRun: boolean;
  repairWeak: boolean;
};

type HubRow = {
  id: string;
  website_id: string;
  account_id: string;
  hub_type: string;
  name: string;
  slug: string;
  max_child_links: number;
  meta_description: string | null;
  parent_slug: string | null;
};

type ChildLink = {
  title: string;
  slug: string;
  quality_score: number | null;
  tier: number | null;
};

function parseArgs(): Args {
  const args: Args = { batch: 100, limit: 0, dryRun: false, repairWeak: false };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "websiteId") args.websiteId = value;
    if (key === "batch") args.batch = Math.max(1, Number(value || 100));
    if (key === "limit") args.limit = Math.max(0, Number(value || 0));
    if (key === "dryRun") args.dryRun = value !== "false";
    if (key === "repairWeak") args.repairWeak = value !== "false";
  }
  if (!args.websiteId) throw new Error("Missing required --websiteId=<id>");
  return args;
}

function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function serviceWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !new Set(["and", "for", "the", "with", "near", "best", "top"]).has(w));
}

async function getStats(websiteId: string) {
  const res = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'published')::int AS published,
       COUNT(*) FILTER (WHERE content IS NOT NULL AND btrim(content) <> '')::int AS with_content,
       COUNT(*) FILTER (WHERE status = 'published' AND (content IS NULL OR btrim(content) = ''))::int AS missing_content,
       COUNT(*) FILTER (WHERE status = 'published' AND content ILIKE '%Related child pages are being organized%')::int AS weak_content
     FROM hub_pages
     WHERE website_id = $1::text`,
    [websiteId],
  );
  return res.rows[0];
}

async function getTargetHubs(websiteId: string, batch: number, repairWeak: boolean): Promise<HubRow[]> {
  const weakSql = repairWeak ? `OR content ILIKE '%Related child pages are being organized%'` : "";
  const res = await pool.query(
    `SELECT id, website_id, account_id, hub_type, name, slug, max_child_links, meta_description, parent_slug
     FROM hub_pages
     WHERE website_id = $1::text
       AND status = 'published'
       AND ((content IS NULL OR btrim(content) = '') ${weakSql})
     ORDER BY created_at ASC, id ASC
     LIMIT $2::int`,
    [websiteId, batch],
  );
  return res.rows;
}

async function getFallbackTopPages(hub: HubRow, maxLinks: number): Promise<ChildLink[]> {
  const res = await pool.query(
    `SELECT title, slug, quality_score, tier
     FROM pages
     WHERE website_id = $1::text
       AND status = 'published'
       AND COALESCE(noindex, false) = false
       AND slug <> $2::text
     ORDER BY COALESCE(quality_score, 0) DESC, COALESCE(tier, 9) ASC, updated_at DESC
     LIMIT $3::int`,
    [hub.website_id, hub.slug, Math.min(maxLinks, 30)],
  );
  return res.rows;
}

async function getChildLinks(hub: HubRow): Promise<ChildLink[]> {
  const maxLinks = Math.max(5, Math.min(Number(hub.max_child_links || 30), 500));

  if (hub.hub_type === "service") {
    const byService = await pool.query(
      `SELECT p.title, p.slug, p.quality_score, p.tier
       FROM pages p
       LEFT JOIN services s ON s.id = p.service_id
       WHERE p.website_id = $1::text
         AND p.status = 'published'
         AND COALESCE(p.noindex, false) = false
         AND p.page_type NOT IN ('state_hub', 'city_hub')
         AND (
           s.slug = $2::text
           OR lower(s.name) = lower($3::text)
           OR p.slug ILIKE $4::text
           OR p.title ILIKE $5::text
           OR p.h1 ILIKE $5::text
         )
       ORDER BY COALESCE(p.quality_score, 0) DESC, COALESCE(p.tier, 9) ASC, p.updated_at DESC
       LIMIT $6::int`,
      [hub.website_id, hub.slug, hub.name, `${hub.slug}-%`, `%${hub.name}%`, maxLinks],
    );
    if (byService.rows.length > 0) return byService.rows;

    const words = serviceWords(hub.name);
    if (words.length > 0) {
      const likeTerms = words.slice(0, 6).map((w) => `%${w}%`);
      const fuzzy = await pool.query(
        `SELECT title, slug, quality_score, tier
         FROM pages
         WHERE website_id = $1::text
           AND status = 'published'
           AND COALESCE(noindex, false) = false
           AND page_type NOT IN ('state_hub', 'city_hub')
           AND (slug ILIKE ANY($2::text[]) OR title ILIKE ANY($2::text[]) OR h1 ILIKE ANY($2::text[]))
         ORDER BY COALESCE(quality_score, 0) DESC, COALESCE(tier, 9) ASC, updated_at DESC
         LIMIT $3::int`,
        [hub.website_id, likeTerms, maxLinks],
      );
      if (fuzzy.rows.length > 0) return fuzzy.rows;
    }
  }

  if (hub.hub_type === "state") {
    const byLocation = await pool.query(
      `SELECT p.title, p.slug, p.quality_score, p.tier
       FROM pages p
       LEFT JOIN locations l ON l.id = p.location_id
       WHERE p.website_id = $1::text
         AND p.status = 'published'
         AND COALESCE(p.noindex, false) = false
         AND (
           l.slug = $2::text
           OR lower(l.name) = lower($3::text)
           OR lower(l.state_name) = lower($3::text)
           OR lower(l.state_code) = lower($2::text)
           OR p.slug ILIKE $4::text
           OR p.title ILIKE $5::text
           OR p.h1 ILIKE $5::text
         )
       ORDER BY COALESCE(p.quality_score, 0) DESC, COALESCE(p.tier, 9) ASC, p.updated_at DESC
       LIMIT $6::int`,
      [hub.website_id, hub.slug, hub.name, `%-${hub.slug}`, `%${hub.name}%`, maxLinks],
    );
    if (byLocation.rows.length > 0) return byLocation.rows;
  }

  if (hub.hub_type === "city") {
    const byLocation = await pool.query(
      `SELECT p.title, p.slug, p.quality_score, p.tier
       FROM pages p
       LEFT JOIN locations l ON l.id = p.location_id
       WHERE p.website_id = $1::text
         AND p.status = 'published'
         AND COALESCE(p.noindex, false) = false
         AND (
           l.slug = $2::text
           OR lower(l.name) = lower($3::text)
           OR p.slug ILIKE $4::text
           OR p.slug ILIKE $5::text
           OR p.title ILIKE $6::text
           OR p.h1 ILIKE $6::text
         )
       ORDER BY COALESCE(p.quality_score, 0) DESC, COALESCE(p.tier, 9) ASC, p.updated_at DESC
       LIMIT $7::int`,
      [hub.website_id, hub.slug, hub.name, `%-in-${hub.slug}-%`, `%${hub.slug}%`, `%${hub.name}%`, maxLinks],
    );
    if (byLocation.rows.length > 0) return byLocation.rows;
  }

  return getFallbackTopPages(hub, maxLinks);
}

function buildHubContent(hub: HubRow, childLinks: ChildLink[]): { html: string; metaDescription: string } {
  const name = escapeHtml(hub.name || titleFromSlug(hub.slug));
  const hubLabel = hub.hub_type === "service" ? "service" : hub.hub_type === "state" ? "state" : "city";
  const metaDescription = hub.meta_description || `${hub.name} hub page with top related pages, local service coverage, and useful resources from this website.`;

  const childItems = childLinks.map((link) => {
    const title = escapeHtml(link.title || titleFromSlug(link.slug));
    const slug = escapeHtml(link.slug);
    const score = link.quality_score == null ? "" : `<span class="hub-link-score">Quality ${escapeHtml(String(link.quality_score))}</span>`;
    return `<li><a href="/${slug}">${title}</a>${score}</li>`;
  }).join("\n");

  const linksSection = childLinks.length > 0
    ? `<section class="hub-section hub-child-links">
  <h2>Top related pages for ${name}</h2>
  <p>Use these pages to compare available services, local coverage, and specific business payment topics connected to ${name}.</p>
  <ul>
    ${childItems}
  </ul>
</section>`
    : `<section class="hub-section hub-child-links">
  <h2>Related pages for ${name}</h2>
  <p>This hub is being organized while related child pages are connected.</p>
</section>`;

  const html = `<section class="hub-hero">
  <p class="hub-eyebrow">${escapeHtml(hubLabel)} hub</p>
  <h1>${name}</h1>
  <p>${escapeHtml(metaDescription)}</p>
</section>

<section class="hub-section">
  <h2>What this hub covers</h2>
  <p>This hub organizes the strongest published pages connected to <strong>${name}</strong>. It helps visitors move from a broad topic into the most relevant child pages without digging through the entire site.</p>
</section>

${linksSection}

<section class="hub-section">
  <h2>How to use this hub</h2>
  <p>Start with the page that best matches your service, market, or local search intent. Each child page gives more specific detail, while this hub keeps the overall topic connected for visitors and search engines.</p>
</section>`;

  return { html, metaDescription };
}

async function updateHub(hub: HubRow, html: string, metaDescription: string, dryRun: boolean, repairWeak: boolean) {
  if (dryRun) return;
  const contentCondition = repairWeak
    ? `AND ((content IS NULL OR btrim(content) = '') OR content ILIKE '%Related child pages are being organized%')`
    : `AND (content IS NULL OR btrim(content) = '')`;

  await pool.query(
    `UPDATE hub_pages
     SET content = $1::text,
         meta_description = COALESCE(meta_description, $2::text),
         updated_at = NOW()
     WHERE id = $3::text
       AND website_id = $4::text
       ${contentCondition}`,
    [html, metaDescription, hub.id, hub.website_id],
  );
}

async function main() {
  const args = parseArgs();
  const websiteId = args.websiteId!;
  let processed = 0;
  let failed = 0;

  console.log(`[hub-backfill] Starting missing hub content backfill for website=${websiteId}`);
  console.log(`[hub-backfill] Options: batch=${args.batch} limit=${args.limit || "none"} dryRun=${args.dryRun} repairWeak=${args.repairWeak}`);
  console.log("[hub-backfill] Before:", await getStats(websiteId));

  while (true) {
    if (args.limit && processed >= args.limit) break;
    const batchSize = args.limit ? Math.min(args.batch, args.limit - processed) : args.batch;
    const hubs = await getTargetHubs(websiteId, batchSize, args.repairWeak);
    if (hubs.length === 0) break;

    for (const hub of hubs) {
      try {
        const childLinks = await getChildLinks(hub);
        const { html, metaDescription } = buildHubContent(hub, childLinks);
        await updateHub(hub, html, metaDescription, args.dryRun, args.repairWeak);
        processed++;
        console.log(`[hub-backfill] filled ${processed}: ${hub.hub_type}/${hub.slug} childLinks=${childLinks.length}`);
      } catch (err: any) {
        failed++;
        console.error(`[hub-backfill] failed ${hub.id} ${hub.slug}:`, err?.message || err);
      }
    }
  }

  console.log("[hub-backfill] After:", await getStats(websiteId));
  console.log(`[hub-backfill] Done. processed=${processed} failed=${failed} dryRun=${args.dryRun} repairWeak=${args.repairWeak}`);
}

main()
  .catch((err) => {
    console.error("[hub-backfill] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
