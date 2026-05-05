import { pool } from "../server/db";

type Args = {
  websiteId?: string;
  limit: number;
};

function parseArgs(): Args {
  const args: Args = { limit: 100 };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "websiteId") args.websiteId = value;
    if (key === "limit") args.limit = Math.max(1, Number(value || 100));
  }
  if (!args.websiteId) throw new Error("Missing required --websiteId=<id>");
  return args;
}

function classify(row: any): string {
  if (row.status !== "published") return "not_published";
  if (row.noindex === true) return "noindex";
  if (!row.active_version_id) return "missing_active_page_version";
  if (!row.content_html || Number(row.content_length || 0) === 0) return "empty_active_content_html";
  if (Number(row.content_length || 0) < 100) return "active_content_html_too_short";
  if (row.r2_key || row.content_hash || row.rendered_at) return "partial_r2_metadata";
  return "missing_r2_metadata_but_appears_renderable";
}

async function main() {
  const { websiteId, limit } = parseArgs();

  const counts = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false)::int AS published_indexable,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND r2_key IS NOT NULL)::int AS has_r2_key,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND content_hash IS NOT NULL)::int AS has_content_hash,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND rendered_at IS NOT NULL)::int AS has_rendered_at,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = false AND (r2_key IS NULL OR content_hash IS NULL OR rendered_at IS NULL))::int AS missing_static_metadata,
      COUNT(*) FILTER (WHERE status = 'published' AND COALESCE(noindex, false) = true)::int AS noindex_published,
      COUNT(*) FILTER (WHERE status <> 'published')::int AS non_published
    FROM pages
    WHERE website_id = $1::text`,
    [websiteId],
  );

  const stuck = await pool.query(
    `SELECT
      p.id,
      p.slug,
      p.title,
      p.page_type,
      p.status,
      p.noindex,
      p.r2_key,
      p.content_hash,
      p.rendered_at,
      p.updated_at,
      p.created_at,
      pv.id AS active_version_id,
      LENGTH(COALESCE(pv.content_html, ''))::int AS content_length,
      LEFT(COALESCE(pv.content_html, ''), 160) AS content_preview
    FROM pages p
    LEFT JOIN page_versions pv
      ON pv.page_id = p.id
     AND pv.is_active = true
    WHERE p.website_id = $1::text
      AND p.status = 'published'
      AND COALESCE(p.noindex, false) = false
      AND (p.r2_key IS NULL OR p.content_hash IS NULL OR p.rendered_at IS NULL)
    ORDER BY p.created_at ASC, p.id ASC
    LIMIT $2::int`,
    [websiteId, limit],
  );

  const rows = stuck.rows.map((row: any) => ({
    reason: classify(row),
    id: row.id,
    slug: row.slug,
    pageType: row.page_type,
    status: row.status,
    noindex: row.noindex,
    hasR2Key: Boolean(row.r2_key),
    hasContentHash: Boolean(row.content_hash),
    hasRenderedAt: Boolean(row.rendered_at),
    activeVersionId: row.active_version_id,
    contentLength: row.content_length,
    title: row.title,
    contentPreview: row.content_preview,
  }));

  const byReason = rows.reduce((acc: Record<string, number>, row: any) => {
    acc[row.reason] = (acc[row.reason] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    websiteId,
    counts: counts.rows[0],
    returned: rows.length,
    byReason,
    stuckPages: rows,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("[r2-diagnose-stuck] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
