import { pool } from "../server/db";
import { checkPageQuality } from "../server/services/page-quality-guardrails";

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
  const limit = Math.min(readNumberArg("limit", 100), 1000);
  const unpublishFailures = process.argv.includes("--unpublish-failures");

  const values: any[] = [];
  const clauses = ["p.status = 'published'"];

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
       pv.content_html
     FROM pages p
     LEFT JOIN page_versions pv ON pv.page_id = p.id AND pv.is_active = true
     WHERE ${clauses.join(" AND ")}
     ORDER BY p.updated_at DESC
     LIMIT ${limitParam}`,
    values,
  );

  const failures: Array<{
    pageId: string;
    websiteId: string;
    slug: string;
    issues: ReturnType<typeof checkPageQuality>["issues"];
  }> = [];

  let warnings = 0;

  for (const row of result.rows) {
    const quality = checkPageQuality({
      pageId: row.id,
      slug: row.slug,
      title: row.title,
      h1: row.h1,
      metaDescription: row.meta_description,
      contentHtml: row.content_html,
    });

    warnings += quality.issues.filter((issue) => issue.severity === "warning").length;

    if (!quality.ok) {
      failures.push({
        pageId: row.id,
        websiteId: row.website_id,
        slug: row.slug,
        issues: quality.issues,
      });
    }
  }

  if (unpublishFailures && failures.length > 0) {
    const ids = failures.map((failure) => failure.pageId);
    await pool.query(
      `UPDATE pages
       SET status = 'review',
           passed_qa = false,
           qa_report = jsonb_build_object(
             'source', 'audit-published-pages',
             'reason', 'quality_guardrail_failed',
             'checked_at', NOW(),
             'issues', $2::jsonb
           ),
           updated_at = NOW()
       WHERE id = ANY($1::varchar[])`,
      [ids, JSON.stringify(failures)],
    );
  }

  const report = {
    websiteId: websiteId ?? "all",
    scanned: result.rows.length,
    failed: failures.length,
    warnings,
    unpublished: unpublishFailures ? failures.length : 0,
    failures: failures.slice(0, 50),
    recommendation:
      failures.length === 0
        ? "Published page sample passed quality guardrails."
        : unpublishFailures
          ? "Failing pages were moved to review. Regenerate or edit them before publishing."
          : "Failing pages found. Re-run with --unpublish-failures to move them to review without deleting them.",
  };

  console.log(JSON.stringify(report, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[audit-published-pages] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
