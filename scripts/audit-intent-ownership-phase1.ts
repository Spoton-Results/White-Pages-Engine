import { pool } from "../server/db";

type Args = {
  websiteId?: string;
  limit: number;
};

function parseArgs(): Args {
  const args: Args = { limit: 25 };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "websiteId") args.websiteId = value;
    if (key === "limit") args.limit = Math.max(1, Number(value || 25));
  }
  return args;
}

async function query(label: string, sql: string, params: any[] = []) {
  console.log(`\n[intent-audit] ${label}`);
  const result = await pool.query(sql, params);
  console.table(result.rows);
}

async function main() {
  const args = parseArgs();
  if (!args.websiteId) throw new Error("Missing required --websiteId=<id>");

  console.log(`[intent-audit] website=${args.websiteId}`);

  await query(
    "Overall counts",
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'published')::int AS published,
      COUNT(*) FILTER (WHERE primary_intent IS NOT NULL)::int AS with_primary_intent,
      COUNT(*) FILTER (WHERE intent_cluster IS NOT NULL)::int AS with_intent_cluster,
      COUNT(*) FILTER (WHERE canonical_owner = true)::int AS canonical_owners,
      COUNT(*) FILTER (WHERE support_role = 'CANONICAL_OWNER')::int AS canonical_support_role,
      COUNT(*) FILTER (WHERE cannibalization_risk IN ('HIGH', 'CRITICAL'))::int AS high_risk
     FROM pages
     WHERE website_id = $1::text`,
    [args.websiteId],
  );

  await query(
    "Page type / tier / owner distribution",
    `SELECT
      page_type::text,
      tier,
      canonical_owner,
      support_role,
      COUNT(*)::int AS count
     FROM pages
     WHERE website_id = $1::text
       AND status = 'published'
     GROUP BY page_type, tier, canonical_owner, support_role
     ORDER BY page_type, tier, canonical_owner DESC, support_role`,
    [args.websiteId],
  );

  await query(
    "Primary intent distribution",
    `SELECT
      COALESCE(primary_intent, 'UNCLASSIFIED') AS primary_intent,
      COALESCE(funnel_stage, 'UNCLASSIFIED') AS funnel_stage,
      canonical_owner,
      COUNT(*)::int AS count
     FROM pages
     WHERE website_id = $1::text
       AND status = 'published'
     GROUP BY primary_intent, funnel_stage, canonical_owner
     ORDER BY count DESC, primary_intent, funnel_stage`,
    [args.websiteId],
  );

  await query(
    "Top intent clusters by page count",
    `SELECT
      COALESCE(intent_cluster, 'UNCLASSIFIED') AS intent_cluster,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE canonical_owner = true)::int AS owners,
      MIN(slug) AS sample_slug
     FROM pages
     WHERE website_id = $1::text
       AND status = 'published'
     GROUP BY intent_cluster
     ORDER BY count DESC, intent_cluster
     LIMIT $2::int`,
    [args.websiteId, args.limit],
  );

  await query(
    "Sample canonical owners",
    `SELECT
      page_type::text,
      tier,
      primary_intent,
      intent_cluster,
      support_role,
      slug
     FROM pages
     WHERE website_id = $1::text
       AND status = 'published'
       AND canonical_owner = true
     ORDER BY page_type, tier, slug
     LIMIT $2::int`,
    [args.websiteId, args.limit],
  );
}

main()
  .catch((err) => {
    console.error("[intent-audit] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
