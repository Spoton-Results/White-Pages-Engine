import { pool } from "../server/db";
import { getPageHtml, isR2Configured } from "../server/services/r2";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function readNumberArg(name: string, fallback: number): number {
  const value = readArg(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

async function main() {
  const websiteId = readArg("websiteId") || readArg("website-id");
  const sample = Math.min(readNumberArg("sample", 10), 100);

  if (!websiteId) {
    throw new Error("Missing required --websiteId=<id> argument");
  }

  const counts = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false) AS published_indexable,
       COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND r2_key IS NOT NULL) AS has_r2_key,
       COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND content_hash IS NOT NULL) AS has_content_hash,
       COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND rendered_at IS NOT NULL) AS has_rendered_at,
       COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND (r2_key IS NULL OR content_hash IS NULL OR rendered_at IS NULL)) AS missing_static_metadata,
       COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = true) AS noindex_published,
       COUNT(*) FILTER (WHERE status != 'published') AS non_published
     FROM pages
     WHERE website_id = $1`,
    [websiteId],
  );

  const sampleRows = await pool.query(
    `SELECT id, slug, r2_key, content_hash, rendered_at
     FROM pages
     WHERE website_id = $1
       AND status = 'published'
       AND COALESCE(noindex, false) = false
       AND r2_key IS NOT NULL
     ORDER BY rendered_at DESC NULLS LAST, updated_at DESC
     LIMIT $2`,
    [websiteId, sample],
  );

  let r2ObjectsChecked = 0;
  let r2ObjectsFound = 0;
  let r2ObjectsMissing = 0;
  const missingSamples: Array<{ pageId: string; slug: string; r2Key: string }> = [];

  if (sample > 0 && isR2Configured()) {
    for (const row of sampleRows.rows) {
      r2ObjectsChecked += 1;
      const html = await getPageHtml(row.r2_key);
      if (html && html.trim().length > 0) {
        r2ObjectsFound += 1;
      } else {
        r2ObjectsMissing += 1;
        missingSamples.push({ pageId: row.id, slug: row.slug, r2Key: row.r2_key });
      }
    }
  }

  const row = counts.rows[0];
  const report = {
    websiteId,
    r2Configured: isR2Configured(),
    counts: {
      publishedIndexable: Number(row.published_indexable ?? 0),
      hasR2Key: Number(row.has_r2_key ?? 0),
      hasContentHash: Number(row.has_content_hash ?? 0),
      hasRenderedAt: Number(row.has_rendered_at ?? 0),
      missingStaticMetadata: Number(row.missing_static_metadata ?? 0),
      noindexPublished: Number(row.noindex_published ?? 0),
      nonPublished: Number(row.non_published ?? 0),
    },
    sampleCheck: {
      requested: sample,
      checked: r2ObjectsChecked,
      found: r2ObjectsFound,
      missing: r2ObjectsMissing,
      missingSamples,
    },
    recommendation:
      Number(row.missing_static_metadata ?? 0) === 0 && r2ObjectsMissing === 0
        ? "Static render metadata looks complete for this website sample. Eligible for next-stage fallback-worker testing."
        : "Do not route live traffic to R2 yet. Render missing pages and resolve missing R2 sample objects first.",
  };

  console.log(JSON.stringify(report, null, 2));

  if (r2ObjectsMissing > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[r2-page-health] Failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
