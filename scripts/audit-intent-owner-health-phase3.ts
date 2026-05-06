import { pool } from "../server/db";

type Args = {
  websiteId?: string;
  minClusterSize: number;
  limit: number;
};

type ReasonCode =
  | "OK"
  | "SINGLE_PAGE_CLUSTER"
  | "BELOW_MIN_CLUSTER_SIZE"
  | "EXCLUDED_HUB_CLUSTER"
  | "NO_ELIGIBLE_CANDIDATE"
  | "MULTIPLE_OWNERS"
  | "OWNER_SUPPORT_ROLE_MISMATCH"
  | "SUPPORTING_PARENT_MISSING"
  | "HIGH_RISK_CLUSTER";

function parseArgs(): Args {
  const args: Args = { minClusterSize: 2, limit: 100 };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "websiteId") args.websiteId = value;
    if (key === "minClusterSize") args.minClusterSize = Math.max(1, Number(value || 2));
    if (key === "limit") args.limit = Math.max(1, Number(value || 100));
  }
  return args;
}

async function query(label: string, sql: string, params: any[]) {
  console.log(`\n[intent-health] ${label}`);
  const result = await pool.query(sql, params);
  console.table(result.rows);
  return result.rows;
}

async function main() {
  const args = parseArgs();
  if (!args.websiteId) throw new Error("Missing required --websiteId=<id>");

  console.log(`[intent-health] website=${args.websiteId}`);
  console.log(`[intent-health] options minClusterSize=${args.minClusterSize} limit=${args.limit}`);

  await query(
    "Overall owner coverage",
    `WITH cluster_stats AS (
       SELECT
         intent_cluster,
         COUNT(*)::int AS page_count,
         COUNT(*) FILTER (WHERE canonical_owner = true)::int AS owner_count,
         BOOL_OR(primary_intent IN ('STATE_HUB', 'REGION_HUB', 'METRO_HUB', 'CITY_HUB')) AS has_hub_intent,
         BOOL_OR(primary_intent NOT IN ('STATE_HUB', 'REGION_HUB', 'METRO_HUB', 'CITY_HUB')) AS has_eligible_intent,
         COUNT(*) FILTER (WHERE cannibalization_risk IN ('HIGH','CRITICAL'))::int AS high_risk_pages
       FROM pages
       WHERE website_id = $1::text
         AND status = 'published'
         AND intent_cluster IS NOT NULL
       GROUP BY intent_cluster
     )
     SELECT
       COUNT(*)::int AS total_clusters,
       COUNT(*) FILTER (WHERE owner_count = 1)::int AS clusters_with_one_owner,
       COUNT(*) FILTER (WHERE owner_count = 0)::int AS clusters_without_owner,
       COUNT(*) FILTER (WHERE owner_count > 1)::int AS clusters_with_multiple_owners,
       COUNT(*) FILTER (WHERE page_count < $2::int)::int AS below_min_cluster_size,
       COUNT(*) FILTER (WHERE page_count = 1)::int AS single_page_clusters,
       COUNT(*) FILTER (WHERE has_hub_intent = true AND has_eligible_intent = false)::int AS excluded_hub_clusters,
       COUNT(*) FILTER (WHERE high_risk_pages > 0)::int AS high_risk_clusters
     FROM cluster_stats`,
    [args.websiteId, args.minClusterSize],
  );

  await query(
    "Skipped clusters with reason codes",
    `WITH cluster_stats AS (
       SELECT
         intent_cluster,
         COUNT(*)::int AS page_count,
         COUNT(*) FILTER (WHERE canonical_owner = true)::int AS owner_count,
         BOOL_OR(primary_intent IN ('STATE_HUB', 'REGION_HUB', 'METRO_HUB', 'CITY_HUB')) AS has_hub_intent,
         BOOL_OR(primary_intent NOT IN ('STATE_HUB', 'REGION_HUB', 'METRO_HUB', 'CITY_HUB')) AS has_eligible_intent,
         COUNT(*) FILTER (WHERE cannibalization_risk IN ('HIGH','CRITICAL'))::int AS high_risk_pages,
         MIN(slug) AS sample_slug
       FROM pages
       WHERE website_id = $1::text
         AND status = 'published'
         AND intent_cluster IS NOT NULL
       GROUP BY intent_cluster
     )
     SELECT
       intent_cluster,
       page_count,
       owner_count,
       CASE
         WHEN owner_count > 1 THEN 'MULTIPLE_OWNERS'
         WHEN high_risk_pages > 0 THEN 'HIGH_RISK_CLUSTER'
         WHEN page_count = 1 THEN 'SINGLE_PAGE_CLUSTER'
         WHEN page_count < $2::int THEN 'BELOW_MIN_CLUSTER_SIZE'
         WHEN has_hub_intent = true AND has_eligible_intent = false THEN 'EXCLUDED_HUB_CLUSTER'
         WHEN owner_count = 0 AND has_eligible_intent = false THEN 'NO_ELIGIBLE_CANDIDATE'
         WHEN owner_count = 0 THEN 'NO_ELIGIBLE_CANDIDATE'
         ELSE 'OK'
       END AS reason_code,
       sample_slug,
       CASE
         WHEN owner_count > 1 THEN 'Reset and reselect one owner for this cluster.'
         WHEN high_risk_pages > 0 THEN 'Review duplicate or cannibalization risk before assigning owner.'
         WHEN page_count = 1 THEN 'No owner needed yet unless this singleton should anchor a new cluster.'
         WHEN page_count < $2::int THEN 'Below minClusterSize threshold; lower threshold or leave unowned.'
         WHEN has_hub_intent = true AND has_eligible_intent = false THEN 'Hub-only cluster intentionally excluded from Phase 2.'
         WHEN owner_count = 0 THEN 'Run owner selection or inspect candidate eligibility.'
         ELSE 'Healthy.'
       END AS recommendation
     FROM cluster_stats
     WHERE owner_count <> 1
     ORDER BY
       CASE
         WHEN owner_count > 1 THEN 1
         WHEN high_risk_pages > 0 THEN 2
         WHEN page_count >= $2::int AND owner_count = 0 THEN 3
         WHEN page_count = 1 THEN 4
         ELSE 5
       END,
       page_count DESC,
       intent_cluster
     LIMIT $3::int`,
    [args.websiteId, args.minClusterSize, args.limit],
  );

  await query(
    "Owner health issues",
    `WITH owner_mismatch AS (
       SELECT
         'OWNER_SUPPORT_ROLE_MISMATCH'::text AS issue,
         intent_cluster,
         slug,
         support_role,
         parent_intent_page_id
       FROM pages
       WHERE website_id = $1::text
         AND status = 'published'
         AND canonical_owner = true
         AND support_role <> 'CANONICAL_OWNER'
     ), supporting_missing_parent AS (
       SELECT
         'SUPPORTING_PARENT_MISSING'::text AS issue,
         intent_cluster,
         slug,
         support_role,
         parent_intent_page_id
       FROM pages
       WHERE website_id = $1::text
         AND status = 'published'
         AND canonical_owner = false
         AND intent_cluster IN (
           SELECT intent_cluster
           FROM pages
           WHERE website_id = $1::text
             AND status = 'published'
             AND canonical_owner = true
         )
         AND parent_intent_page_id IS NULL
     ), multiple_owners AS (
       SELECT
         'MULTIPLE_OWNERS'::text AS issue,
         intent_cluster,
         MIN(slug) AS slug,
         NULL::text AS support_role,
         NULL::text AS parent_intent_page_id
       FROM pages
       WHERE website_id = $1::text
         AND status = 'published'
         AND canonical_owner = true
       GROUP BY intent_cluster
       HAVING COUNT(*) > 1
     )
     SELECT * FROM owner_mismatch
     UNION ALL
     SELECT * FROM supporting_missing_parent
     UNION ALL
     SELECT * FROM multiple_owners
     ORDER BY issue, intent_cluster, slug
     LIMIT $2::int`,
    [args.websiteId, args.limit],
  );

  await query(
    "Top canonical owners by cluster size",
    `SELECT
       p.intent_cluster,
       COUNT(all_pages.id)::int AS cluster_pages,
       p.slug AS owner_slug,
       p.primary_intent,
       p.support_role,
       p.authority_weight,
       p.quality_score,
       p.trust_score,
       p.evidence_score
     FROM pages p
     JOIN pages all_pages
       ON all_pages.website_id = p.website_id
      AND all_pages.intent_cluster = p.intent_cluster
      AND all_pages.status = 'published'
     WHERE p.website_id = $1::text
       AND p.status = 'published'
       AND p.canonical_owner = true
     GROUP BY p.intent_cluster, p.slug, p.primary_intent, p.support_role, p.authority_weight, p.quality_score, p.trust_score, p.evidence_score
     ORDER BY cluster_pages DESC, p.intent_cluster
     LIMIT $2::int`,
    [args.websiteId, args.limit],
  );
}

main()
  .catch((err) => {
    console.error("[intent-health] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
