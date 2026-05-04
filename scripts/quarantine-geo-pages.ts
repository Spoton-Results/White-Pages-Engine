import { pool } from "../server/db";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function readNumberArg(name: string, fallback: number): number {
  const value = readArg(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const websiteId = readArg("websiteId") || readArg("website-id");
  const limit = Math.min(readNumberArg("limit", 500), 5000);
  const dryRun = process.argv.includes("--dry-run");
  const confirm = process.argv.includes("--confirm");
  const targetStatus = readArg("status") || "review";

  if (!websiteId) {
    throw new Error("Missing --websiteId=<WEBSITE_ID>. This command is intentionally website-scoped.");
  }

  if (!["review", "pruned", "draft"].includes(targetStatus)) {
    throw new Error("Invalid --status. Use review, pruned, or draft.");
  }

  if (!dryRun && !confirm) {
    throw new Error("Refusing to modify pages without --confirm. Run with --dry-run first, then --confirm.");
  }

  const candidates = await pool.query(
    `SELECT
       p.id,
       p.website_id,
       p.slug,
       p.title,
       p.h1,
       p.meta_description,
       p.status,
       p.page_type,
       pv.content_html
     FROM pages p
     LEFT JOIN page_versions pv ON pv.page_id = p.id AND pv.is_active = true
     WHERE p.website_id = $1
       AND p.status = 'published'
       AND (
         p.slug ~ '([a-z0-9]+)-\\1$'
         OR p.title ~* '\\b([A-Za-z][A-Za-z .''-]{2,})\\s*,\\s*\\1\\b'
         OR p.h1 ~* '\\b([A-Za-z][A-Za-z .''-]{2,})\\s*,\\s*\\1\\b'
         OR p.meta_description ~* '\\b([A-Za-z][A-Za-z .''-]{2,})\\s*,\\s*\\1\\b'
         OR pv.content_html ~* '\\b([A-Za-z][A-Za-z .''-]{2,})\\s*,\\s*\\1\\b'
       )
     ORDER BY p.updated_at DESC
     LIMIT $2`,
    [websiteId, limit],
  );

  const rows = candidates.rows;

  if (!dryRun && rows.length > 0) {
    const ids = rows.map((row) => row.id);
    await pool.query(
      `UPDATE pages
       SET status = $2,
           noindex = true,
           passed_qa = false,
           qa_report = COALESCE(qa_report, '{}'::jsonb) || jsonb_build_object(
             'geo_quarantine', jsonb_build_object(
               'quarantined_at', NOW(),
               'reason', 'duplicate_geo_or_duplicate_state_slug',
               'previous_status', 'published',
               'target_status', $2,
               'source', 'quarantine-geo-pages'
             )
           ),
           updated_at = NOW()
       WHERE id = ANY($1::varchar[])`,
      [ids, targetStatus],
    );
  }

  const report = {
    websiteId,
    dryRun,
    targetStatus,
    scannedLimit: limit,
    candidateCount: rows.length,
    changedCount: dryRun ? 0 : rows.length,
    candidates: rows.slice(0, 100).map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      h1: row.h1,
      pageType: row.page_type,
      previousStatus: row.status,
    })),
    recommendation:
      rows.length === 0
        ? "No published duplicate-geo pages found for this website."
        : dryRun
          ? "Dry run only. Re-run with --confirm to move these published pages to review without deleting them."
          : `Moved ${rows.length} published page(s) to ${targetStatus}. Rows and page versions were preserved.`,
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error("[quarantine-geo-pages] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
