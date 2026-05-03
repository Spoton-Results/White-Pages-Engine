import { pool } from "../server/db";

const DUPLICATE_GEO_PATTERN = /\b([A-Z][A-Za-z .'-]{2,})\s*,\s*\1\b/g;

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

function repairDuplicateGeo(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value
    .replace(DUPLICATE_GEO_PATTERN, (_match, place) => place)
    .replace(/\s{2,}/g, " ")
    .trim();
}

function changed(before: string | null | undefined, after: string | null | undefined): boolean {
  return (before ?? "") !== (after ?? "");
}

async function main() {
  const websiteId = readArg("websiteId") || readArg("website-id");
  const limit = Math.min(readNumberArg("limit", 100), 1000);
  const dryRun = process.argv.includes("--dry-run");

  const values: any[] = [];
  const clauses = ["p.status IN ('published', 'review', 'draft')"];

  if (websiteId) {
    values.push(websiteId);
    clauses.push(`p.website_id = $${values.length}`);
  }

  values.push(limit);
  const limitParam = `$${values.length}`;

  const result = await pool.query(
    `SELECT
       p.id,
       p.website_id,
       p.slug,
       p.title,
       p.h1,
       p.meta_description,
       pv.id AS page_version_id,
       pv.content_html
     FROM pages p
     LEFT JOIN page_versions pv ON pv.page_id = p.id AND pv.is_active = true
     WHERE ${clauses.join(" AND ")}
       AND (
         p.title ~ ',\\s*[^,]+$'
         OR p.h1 ~ ',\\s*[^,]+$'
         OR p.meta_description ~ ',\\s*[^,]+$'
         OR pv.content_html ~ ',\\s*[^,]+$'
       )
     ORDER BY p.updated_at DESC
     LIMIT ${limitParam}`,
    values,
  );

  const repairs: Array<{
    pageId: string;
    websiteId: string;
    slug: string;
    fields: string[];
  }> = [];

  for (const row of result.rows) {
    const nextTitle = repairDuplicateGeo(row.title);
    const nextH1 = repairDuplicateGeo(row.h1);
    const nextMeta = repairDuplicateGeo(row.meta_description);
    const nextContent = repairDuplicateGeo(row.content_html);

    const fields: string[] = [];
    if (changed(row.title, nextTitle)) fields.push("title");
    if (changed(row.h1, nextH1)) fields.push("h1");
    if (changed(row.meta_description, nextMeta)) fields.push("meta_description");
    if (changed(row.content_html, nextContent)) fields.push("content_html");

    if (fields.length === 0) continue;

    repairs.push({
      pageId: row.id,
      websiteId: row.website_id,
      slug: row.slug,
      fields,
    });

    if (!dryRun) {
      await pool.query(
        `UPDATE pages
         SET title = $1,
             h1 = $2,
             meta_description = $3,
             qa_report = COALESCE(qa_report, '{}'::jsonb) || jsonb_build_object(
               'duplicate_geo_repair', jsonb_build_object(
                 'repaired_at', NOW(),
                 'fields', $4::jsonb
               )
             ),
             updated_at = NOW()
         WHERE id = $5`,
        [nextTitle, nextH1, nextMeta, JSON.stringify(fields), row.id],
      );

      if (row.page_version_id && nextContent != null && fields.includes("content_html")) {
        await pool.query(
          `UPDATE page_versions
           SET content_html = $1
           WHERE id = $2`,
          [nextContent, row.page_version_id],
        );
      }
    }
  }

  const report = {
    websiteId: websiteId ?? "all",
    dryRun,
    scannedCandidates: result.rows.length,
    repairCount: repairs.length,
    repairs: repairs.slice(0, 50),
    recommendation:
      dryRun
        ? "Dry run complete. Re-run without --dry-run to apply repairs."
        : "Repairs applied. Run npm run qa:audit-pages to verify quality guardrails now pass.",
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error("[repair-duplicate-geo-pages] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
