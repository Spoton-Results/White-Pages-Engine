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
  page_type: string;
};

function parseArgs(): Args {
  const args: Args = { limit: 0, dryRun: false };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "websiteId") args.websiteId = value;
    if (key === "limit") args.limit = Math.max(0, Number(value || 0));
    if (key === "dryRun") args.dryRun = value !== "false";
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

function inferServiceAndLocation(title: string, slug: string): { service: string; location: string } {
  const cleanTitle = title.replace(/\s*\|.*$/i, "").trim();
  const titleMatch = cleanTitle.match(/^(.+?)\s+in\s+(.+)$/i);
  if (titleMatch) return { service: titleMatch[1].trim(), location: titleMatch[2].trim() };

  const slugMatch = slug.match(/^(.+?)-in-(.+?)(?:-how-to-.+)?$/i);
  if (slugMatch) {
    return { service: titleFromSlug(slugMatch[1]), location: titleFromSlug(slugMatch[2]) };
  }

  return { service: cleanTitle || titleFromSlug(slug), location: "your area" };
}

function buildRepairContent(page: PageRow): string {
  const h1 = page.h1 || page.title || titleFromSlug(page.slug);
  const { service, location } = inferServiceAndLocation(page.title || h1, page.slug);
  const safeH1 = escapeHtml(h1);
  const safeService = escapeHtml(service);
  const safeLocation = escapeHtml(location);
  const safeMeta = escapeHtml(page.meta_description || `${service} in ${location}. Learn how local organizations can accept card payments, reduce friction, and choose a payment setup that supports day-to-day operations.`);

  return `<section class="repair-page-intro">
  <h2>${safeH1}</h2>
  <p>${safeMeta}</p>
</section>

<section>
  <h2>Accepting payments in ${safeLocation}</h2>
  <p>Organizations looking for <strong>${safeService}</strong> need a setup that makes card acceptance simple, reliable, and easy to manage. This page gives a practical starting point for comparing payment options, improving checkout flow, and supporting common business or nonprofit payment needs in ${safeLocation}.</p>
</section>

<section>
  <h2>What to look for</h2>
  <ul>
    <li>Transparent pricing and clear monthly costs.</li>
    <li>Reliable card-present and online payment acceptance.</li>
    <li>Simple reporting for deposits, transactions, and reconciliation.</li>
    <li>Support for invoices, recurring payments, donations, or service payments when needed.</li>
    <li>Responsive support when payment issues affect cash flow.</li>
  </ul>
</section>

<section>
  <h2>Local payment planning</h2>
  <p>Payment needs can vary by organization size, sales channel, transaction volume, and customer behavior. A good payment setup should fit how the organization actually operates rather than forcing staff into extra steps or disconnected tools.</p>
</section>

<section>
  <h2>Next step</h2>
  <p>Review your current statement, checkout process, and reporting workflow. If costs are unclear or payments are creating friction, it may be time to compare a cleaner processing setup.</p>
</section>`;
}

async function getStats(websiteId: string) {
  const res = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE p.status = 'published' AND COALESCE(p.noindex, false) = false)::int AS published_indexable,
      COUNT(*) FILTER (WHERE p.status = 'published' AND COALESCE(p.noindex, false) = false AND pv.id IS NULL)::int AS missing_active_page_version,
      COUNT(*) FILTER (WHERE p.status = 'published' AND COALESCE(p.noindex, false) = false AND (p.r2_key IS NULL OR p.content_hash IS NULL OR p.rendered_at IS NULL))::int AS missing_static_metadata
    FROM pages p
    LEFT JOIN page_versions pv ON pv.page_id = p.id AND pv.is_active = true
    WHERE p.website_id = $1::text`,
    [websiteId],
  );
  return res.rows[0];
}

async function getTargets(websiteId: string, limit: number): Promise<PageRow[]> {
  const limitSql = limit > 0 ? `LIMIT $2::int` : "";
  const params: any[] = [websiteId];
  if (limit > 0) params.push(limit);

  const res = await pool.query(
    `SELECT p.id, p.slug, p.title, p.h1, p.meta_description, p.page_type
     FROM pages p
     LEFT JOIN page_versions pv ON pv.page_id = p.id AND pv.is_active = true
     WHERE p.website_id = $1::text
       AND p.status = 'published'
       AND COALESCE(p.noindex, false) = false
       AND pv.id IS NULL
       AND (p.r2_key IS NULL OR p.content_hash IS NULL OR p.rendered_at IS NULL)
     ORDER BY p.created_at ASC, p.id ASC
     ${limitSql}`,
    params,
  );
  return res.rows;
}

async function repairPage(page: PageRow, dryRun: boolean) {
  const contentHtml = buildRepairContent(page);
  if (dryRun) return;

  await pool.query("BEGIN");
  try {
    await pool.query(
      `UPDATE page_versions
       SET is_active = false
       WHERE page_id = $1::text`,
      [page.id],
    );

    const versionRes = await pool.query(
      `SELECT COALESCE(MAX(version), 0)::int + 1 AS next_version
       FROM page_versions
       WHERE page_id = $1::text`,
      [page.id],
    );
    const nextVersion = versionRes.rows[0]?.next_version ?? 1;

    await pool.query(
      `INSERT INTO page_versions (page_id, version, content_html, content_json, is_active, review_notes)
       VALUES ($1::text, $2::int, $3::text, $4::jsonb, true, $5::text)`,
      [
        page.id,
        nextVersion,
        contentHtml,
        JSON.stringify({ repairedBy: "repair-missing-active-page-versions", source: "fallback-template" }),
        "Created by repair-missing-active-page-versions because published page had no active page version.",
      ],
    );

    await pool.query(
      `UPDATE pages
       SET updated_at = NOW(),
           r2_key = NULL,
           content_hash = NULL,
           rendered_at = NULL
       WHERE id = $1::text`,
      [page.id],
    );

    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  const args = parseArgs();
  const websiteId = args.websiteId!;
  let processed = 0;
  let failed = 0;

  console.log(`[repair-missing-versions] Starting website=${websiteId}`);
  console.log(`[repair-missing-versions] Options: limit=${args.limit || "none"} dryRun=${args.dryRun}`);
  console.log("[repair-missing-versions] Before:", await getStats(websiteId));

  const targets = await getTargets(websiteId, args.limit);
  console.log(`[repair-missing-versions] Found ${targets.length} target page(s)`);

  for (const page of targets) {
    try {
      await repairPage(page, args.dryRun);
      processed++;
      console.log(`[repair-missing-versions] repaired ${processed}: ${page.page_type}/${page.slug}`);
    } catch (err: any) {
      failed++;
      console.error(`[repair-missing-versions] failed ${page.id} ${page.slug}:`, err?.message || err);
    }
  }

  console.log("[repair-missing-versions] After:", await getStats(websiteId));
  console.log(`[repair-missing-versions] Done. processed=${processed} failed=${failed} dryRun=${args.dryRun}`);
}

main()
  .catch((err) => {
    console.error("[repair-missing-versions] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
