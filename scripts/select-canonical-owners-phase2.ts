import { pool } from "../server/db";

type Args = {
  websiteId?: string;
  limit: number;
  minClusterSize: number;
  dryRun: boolean;
  resetExisting: boolean;
};

type ClusterRow = {
  intent_cluster: string;
  page_count: number;
  max_authority: number | null;
  avg_authority: number | null;
};

type CandidateRow = {
  id: string;
  slug: string;
  page_type: string;
  tier: number;
  primary_intent: string;
  support_role: string | null;
  quality_score: number | null;
  trust_score: number | null;
  evidence_score: number | null;
  content_quality_score: number | null;
  authority_weight: number | null;
  overlap_risk: number | null;
  fallback_hit_count: number | null;
  impressions: number | null;
  clicks: number | null;
  avg_position: string | null;
  rank_score: string | null;
};

function parseArgs(): Args {
  const args: Args = {
    limit: 100,
    minClusterSize: 2,
    dryRun: false,
    resetExisting: false,
  };

  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "websiteId") args.websiteId = value;
    if (key === "limit") args.limit = Math.max(1, Number(value || 100));
    if (key === "minClusterSize") args.minClusterSize = Math.max(1, Number(value || 2));
    if (key === "dryRun") args.dryRun = value !== "false";
    if (key === "resetExisting") args.resetExisting = value !== "false";
  }

  return args;
}

async function getStats(websiteId: string) {
  const res = await pool.query(
    `SELECT
      COUNT(*)::int AS published,
      COUNT(*) FILTER (WHERE primary_intent IS NOT NULL)::int AS classified,
      COUNT(*) FILTER (WHERE intent_cluster IS NOT NULL)::int AS clustered,
      COUNT(*) FILTER (WHERE canonical_owner = true)::int AS canonical_owners,
      COUNT(DISTINCT intent_cluster)::int AS cluster_count,
      COUNT(DISTINCT intent_cluster) FILTER (WHERE canonical_owner = true)::int AS clusters_with_owner
     FROM pages
     WHERE website_id = $1::text
       AND status = 'published'`,
    [websiteId],
  );
  return res.rows[0];
}

async function getClusters(args: Args): Promise<ClusterRow[]> {
  if (!args.websiteId) throw new Error("Missing required --websiteId=<id>");

  const res = await pool.query(
    `SELECT
      intent_cluster,
      COUNT(*)::int AS page_count,
      MAX(authority_weight)::int AS max_authority,
      ROUND(AVG(authority_weight)::numeric, 2) AS avg_authority
     FROM pages
     WHERE website_id = $1::text
       AND status = 'published'
       AND intent_cluster IS NOT NULL
       AND primary_intent IS NOT NULL
       AND primary_intent NOT IN ('STATE_HUB', 'REGION_HUB', 'METRO_HUB', 'CITY_HUB')
     GROUP BY intent_cluster
     HAVING COUNT(*) >= $2::int
     ORDER BY page_count DESC, intent_cluster ASC
     LIMIT $3::int`,
    [args.websiteId, args.minClusterSize, args.limit],
  );

  return res.rows;
}

async function getBestCandidate(websiteId: string, intentCluster: string): Promise<CandidateRow | null> {
  const res = await pool.query(
    `WITH metrics AS (
       SELECT
         page_id,
         SUM(impressions)::int AS impressions,
         SUM(clicks)::int AS clicks,
         MIN(avg_position)::text AS avg_position
       FROM page_metrics
       GROUP BY page_id
     )
     SELECT
       p.id,
       p.slug,
       p.page_type::text AS page_type,
       p.tier,
       p.primary_intent,
       p.support_role,
       p.quality_score,
       p.trust_score,
       p.evidence_score,
       p.content_quality_score,
       p.authority_weight,
       p.overlap_risk,
       p.fallback_hit_count,
       COALESCE(m.impressions, 0)::int AS impressions,
       COALESCE(m.clicks, 0)::int AS clicks,
       m.avg_position,
       (
         COALESCE(p.authority_weight, 0) * 1.00
         + COALESCE(p.quality_score, 0) * 0.35
         + COALESCE(p.trust_score, 0) * 0.25
         + COALESCE(p.evidence_score, 0) * 0.20
         + COALESCE(p.content_quality_score, 0) * 0.10
         + CASE WHEN p.tier = 1 THEN 20 WHEN p.tier = 2 THEN 8 ELSE 0 END
         + LEAST(COALESCE(m.impressions, 0) / 10.0, 25)
         + LEAST(COALESCE(m.clicks, 0) * 2.0, 25)
         - COALESCE(p.overlap_risk, 0) * 0.25
       )::numeric(10,2) AS rank_score
     FROM pages p
     LEFT JOIN metrics m ON m.page_id = p.id
     WHERE p.website_id = $1::text
       AND p.status = 'published'
       AND p.intent_cluster = $2::text
       AND p.primary_intent IS NOT NULL
       AND p.primary_intent NOT IN ('STATE_HUB', 'REGION_HUB', 'METRO_HUB', 'CITY_HUB')
     ORDER BY
       rank_score DESC,
       COALESCE(m.clicks, 0) DESC,
       COALESCE(m.impressions, 0) DESC,
       COALESCE(p.authority_weight, 0) DESC,
       COALESCE(p.quality_score, 0) DESC,
       p.slug ASC
     LIMIT 1`,
    [websiteId, intentCluster],
  );

  return res.rows[0] || null;
}

async function setClusterOwner(websiteId: string, intentCluster: string, ownerId: string) {
  await pool.query(
    `UPDATE pages
     SET canonical_owner = false,
         support_role = CASE
           WHEN primary_intent = 'COMPARISON_INTENT' THEN 'COMPARISON_PAGE'
           WHEN primary_intent = 'PRICING_INTENT' THEN 'PRICING_PAGE'
           WHEN primary_intent IN ('CASE_STUDY_INTENT', 'RESULTS_INTENT') THEN 'PROOF_PAGE'
           WHEN primary_intent = 'DEFINITION_INTENT' THEN 'DEFINITION_PAGE'
           WHEN primary_intent = 'FAQ_INTENT' THEN 'FAQ_PAGE'
           WHEN primary_intent IN ('TOOL_INTENT', 'CALCULATOR_INTENT') THEN 'UTILITY_PAGE'
           ELSE 'SUPPORTING_PAGE'
         END,
         parent_intent_page_id = $3::text,
         updated_at = NOW()
     WHERE website_id = $1::text
       AND intent_cluster = $2::text
       AND status = 'published'`,
    [websiteId, intentCluster, ownerId],
  );

  await pool.query(
    `UPDATE pages
     SET canonical_owner = true,
         support_role = 'CANONICAL_OWNER',
         parent_intent_page_id = NULL,
         intent_last_evaluated_at = NOW(),
         updated_at = NOW()
     WHERE id = $1::text`,
    [ownerId],
  );
}

async function resetCanonicalOwners(websiteId: string) {
  await pool.query(
    `UPDATE pages
     SET canonical_owner = false,
         support_role = CASE
           WHEN primary_intent = 'COMPARISON_INTENT' THEN 'COMPARISON_PAGE'
           WHEN primary_intent = 'PRICING_INTENT' THEN 'PRICING_PAGE'
           WHEN primary_intent IN ('CASE_STUDY_INTENT', 'RESULTS_INTENT') THEN 'PROOF_PAGE'
           WHEN primary_intent = 'DEFINITION_INTENT' THEN 'DEFINITION_PAGE'
           WHEN primary_intent = 'FAQ_INTENT' THEN 'FAQ_PAGE'
           WHEN primary_intent IN ('TOOL_INTENT', 'CALCULATOR_INTENT') THEN 'UTILITY_PAGE'
           ELSE support_role
         END,
         parent_intent_page_id = NULL,
         updated_at = NOW()
     WHERE website_id = $1::text
       AND status = 'published'
       AND canonical_owner = true`,
    [websiteId],
  );
}

async function main() {
  const args = parseArgs();
  if (!args.websiteId) throw new Error("Missing required --websiteId=<id>");

  console.log(`[intent-phase2] Starting canonical owner selection website=${args.websiteId}`);
  console.log(`[intent-phase2] Options: limit=${args.limit} minClusterSize=${args.minClusterSize} dryRun=${args.dryRun} resetExisting=${args.resetExisting}`);
  console.log("[intent-phase2] Before:", await getStats(args.websiteId));

  if (args.resetExisting && !args.dryRun) {
    console.log("[intent-phase2] Resetting existing canonical owners...");
    await resetCanonicalOwners(args.websiteId);
  }

  const clusters = await getClusters(args);
  console.log(`[intent-phase2] Found ${clusters.length} cluster(s) to evaluate`);

  let selected = 0;
  let failed = 0;

  for (const cluster of clusters) {
    try {
      const candidate = await getBestCandidate(args.websiteId, cluster.intent_cluster);
      if (!candidate) continue;

      selected++;
      console.log(
        `[intent-phase2] ${selected}: cluster=${cluster.intent_cluster} pages=${cluster.page_count} owner=${candidate.slug} score=${candidate.rank_score} intent=${candidate.primary_intent}`,
      );

      if (!args.dryRun) {
        await setClusterOwner(args.websiteId, cluster.intent_cluster, candidate.id);
      }
    } catch (err: any) {
      failed++;
      console.error(`[intent-phase2] failed cluster=${cluster.intent_cluster}:`, err?.message || err);
    }
  }

  console.log("[intent-phase2] After:", await getStats(args.websiteId));
  console.log(`[intent-phase2] Done. selected=${selected} failed=${failed} dryRun=${args.dryRun}`);
}

main()
  .catch((err) => {
    console.error("[intent-phase2] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
