import { pool } from "../server/db";
import {
  buildIntentCluster,
  funnelStageFromIntent,
  hasModifierIntentSlug,
  intentTypeFromPageType,
  riskFromOverlapScore,
  supportRoleFromIntent,
} from "../shared/intent-ownership";

type Args = {
  websiteId?: string;
  dryRun: boolean;
  phase: "all" | "backfill" | "owners" | "audit";
  ownerLimit: number;
  minClusterSize: number;
  reclassify: boolean;
  resetOwners: boolean;
  batchSize: number;
};

type PageRow = {
  id: string;
  website_id: string;
  page_type: string;
  slug: string;
  title: string;
  tier: number;
  quality_score: number | null;
  trust_score: number | null;
  evidence_score: number | null;
  content_quality_score: number | null;
  fallback_hit_count: number;
  service_slug: string | null;
  service_name: string | null;
  location_slug: string | null;
  location_name: string | null;
  state_code: string | null;
  state_name: string | null;
};

type CandidateRow = {
  id: string;
  slug: string;
  page_type: string;
  tier: number;
  primary_intent: string;
  support_role: string | null;
  rank_score: string | null;
};

function parseArgs(): Args {
  const args: Args = {
    dryRun: false,
    phase: "all",
    ownerLimit: 100000,
    minClusterSize: 2,
    reclassify: false,
    resetOwners: false,
    batchSize: 1000,
  };

  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "websiteId") args.websiteId = value;
    if (key === "dryRun") args.dryRun = value !== "false";
    if (key === "phase" && ["all", "backfill", "owners", "audit"].includes(value)) args.phase = value as Args["phase"];
    if (key === "ownerLimit") args.ownerLimit = Math.max(1, Number(value || 100000));
    if (key === "minClusterSize") args.minClusterSize = Math.max(1, Number(value || 2));
    if (key === "reclassify") args.reclassify = value !== "false";
    if (key === "resetOwners") args.resetOwners = value !== "false";
    if (key === "batchSize") args.batchSize = Math.max(50, Number(value || 1000));
  }

  return args;
}

function authorityWeight(row: PageRow): number {
  const quality = row.quality_score || 0;
  const trust = row.trust_score || 0;
  const evidence = row.evidence_score || 0;
  const content = row.content_quality_score || 0;
  const tierBoost = row.tier === 1 ? 25 : row.tier === 2 ? 10 : 0;
  const fallbackBoost = Math.min(row.fallback_hit_count || 0, 25);
  return Math.max(0, Math.min(100, Math.round((quality * 0.45) + (trust * 0.2) + (evidence * 0.15) + (content * 0.1) + tierBoost + fallbackBoost)));
}

function isCanonicalOwner(row: PageRow): boolean {
  const intent = intentTypeFromPageType(row.page_type, row.slug);
  if (hasModifierIntentSlug(row.slug)) return false;
  if (intent === "STATE_HUB" || intent === "CITY_HUB" || intent === "REGION_HUB" || intent === "METRO_HUB") return true;
  return false;
}

function overlapRisk(row: PageRow): number {
  let score = 0;
  const slug = row.slug.toLowerCase();
  if (hasModifierIntentSlug(slug)) score += 15;
  if (slug.includes("best-") || slug.includes("top-")) score += 15;
  if (slug.includes("pricing") || slug.includes("rates") || slug.includes("cost") || slug.includes("fees")) score += 10;
  if (slug.includes("services") && slug.includes("processing")) score += 10;
  if (row.page_type === "service_city") score += 10;
  if (row.quality_score && row.quality_score < 60) score += 20;
  if (row.trust_score && row.trust_score < 60) score += 10;
  return Math.max(0, Math.min(100, score));
}

async function stats(websiteId: string) {
  const result = await pool.query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'published')::int AS published,
      COUNT(*) FILTER (WHERE status = 'published' AND primary_intent IS NOT NULL)::int AS classified,
      COUNT(*) FILTER (WHERE status = 'published' AND intent_cluster IS NOT NULL)::int AS clustered,
      COUNT(*) FILTER (WHERE status = 'published' AND canonical_owner = true)::int AS canonical_owners,
      COUNT(DISTINCT intent_cluster)::int AS cluster_count,
      COUNT(DISTINCT intent_cluster) FILTER (WHERE canonical_owner = true)::int AS clusters_with_owner,
      COUNT(*) FILTER (WHERE status = 'published' AND cannibalization_risk IN ('HIGH','CRITICAL'))::int AS high_risk
     FROM pages
     WHERE website_id = $1::text`,
    [websiteId],
  );
  return result.rows[0];
}

async function audit(websiteId: string) {
  console.log("\n[intent-pipeline] AUDIT overall");
  console.table([await stats(websiteId)]);

  console.log("\n[intent-pipeline] AUDIT primary intent distribution");
  const intents = await pool.query(
    `SELECT
      COALESCE(primary_intent, 'UNCLASSIFIED') AS primary_intent,
      COALESCE(funnel_stage, 'UNCLASSIFIED') AS funnel_stage,
      canonical_owner,
      COUNT(*)::int AS count
     FROM pages
     WHERE website_id = $1::text
       AND status = 'published'
     GROUP BY primary_intent, funnel_stage, canonical_owner
     ORDER BY count DESC`,
    [websiteId],
  );
  console.table(intents.rows);

  console.log("\n[intent-pipeline] AUDIT owner clusters");
  const owners = await pool.query(
    `SELECT
      intent_cluster,
      COUNT(*)::int AS pages,
      COUNT(*) FILTER (WHERE canonical_owner = true)::int AS owners,
      MIN(slug) FILTER (WHERE canonical_owner = true) AS owner_slug
     FROM pages
     WHERE website_id = $1::text
       AND status = 'published'
       AND intent_cluster IS NOT NULL
     GROUP BY intent_cluster
     HAVING COUNT(*) FILTER (WHERE canonical_owner = true) > 0
     ORDER BY pages DESC, intent_cluster
     LIMIT 30`,
    [websiteId],
  );
  console.table(owners.rows);
}

async function getBackfillBatch(websiteId: string, limit: number, reclassify: boolean): Promise<PageRow[]> {
  const where = ["p.website_id = $1::text", "p.status = 'published'"];
  if (!reclassify) where.push("(p.primary_intent IS NULL OR p.intent_cluster IS NULL OR p.funnel_stage IS NULL)");

  const result = await pool.query(
    `SELECT
      p.id,
      p.website_id,
      p.page_type::text AS page_type,
      p.slug,
      p.title,
      p.tier,
      p.quality_score,
      p.trust_score,
      p.evidence_score,
      p.content_quality_score,
      p.fallback_hit_count,
      s.slug AS service_slug,
      s.name AS service_name,
      l.slug AS location_slug,
      l.name AS location_name,
      l.state_code,
      l.state_name
     FROM pages p
     LEFT JOIN services s ON s.id = p.service_id
     LEFT JOIN locations l ON l.id = p.location_id
     WHERE ${where.join(" AND ")}
     ORDER BY p.website_id ASC, p.page_type ASC, p.slug ASC
     LIMIT $2::int`,
    [websiteId, limit],
  );
  return result.rows;
}

async function backfillAll(websiteId: string, batchSize: number, dryRun: boolean, reclassify: boolean) {
  console.log("\n[intent-pipeline] BACKFILL starting", { batchSize, dryRun, reclassify });
  let total = 0;
  let loops = 0;

  while (true) {
    loops++;
    const rows = await getBackfillBatch(websiteId, batchSize, reclassify && loops === 1);
    if (!rows.length) break;

    for (const row of rows) {
      const primaryIntent = intentTypeFromPageType(row.page_type, row.slug);
      const funnelStage = funnelStageFromIntent(primaryIntent);
      const canonicalOwner = isCanonicalOwner(row);
      const supportRole = supportRoleFromIntent(primaryIntent, canonicalOwner);
      const cluster = buildIntentCluster({
        pageType: row.page_type,
        slug: row.slug,
        serviceSlug: row.service_slug,
        serviceName: row.service_name,
        locationSlug: row.location_slug,
        locationName: row.location_name,
        stateCode: row.state_code,
        stateName: row.state_name,
      });
      const riskScore = overlapRisk(row);
      const risk = riskFromOverlapScore(riskScore);
      const authority = authorityWeight(row);
      const intentFamily = primaryIntent.replace(/_INTENT$/, "").replace(/_HUB$/, "_HUB");

      if (!dryRun) {
        await pool.query(
          `UPDATE pages
           SET primary_intent = $1::text,
               intent_family = $2::text,
               funnel_stage = $3::text,
               canonical_owner = $4::boolean,
               overlap_risk = $5::int,
               authority_weight = $6::int,
               intent_cluster = $7::text,
               support_role = $8::text,
               cannibalization_risk = $9::text,
               intent_last_evaluated_at = NOW(),
               updated_at = NOW()
           WHERE id = $10::text`,
          [primaryIntent, intentFamily, funnelStage, canonicalOwner, riskScore, authority, cluster, supportRole, risk, row.id],
        );
      }
      total++;
    }

    console.log(`[intent-pipeline] backfilled batch=${rows.length} total=${total}`);
    if (dryRun || reclassify) break;
  }

  console.log(`[intent-pipeline] BACKFILL done total=${total} dryRun=${dryRun}`);
}

async function getClusters(websiteId: string, minClusterSize: number, limit: number) {
  const result = await pool.query(
    `SELECT intent_cluster, COUNT(*)::int AS page_count
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
    [websiteId, minClusterSize, limit],
  );
  return result.rows as { intent_cluster: string; page_count: number }[];
}

async function getBestCandidate(websiteId: string, intentCluster: string): Promise<CandidateRow | null> {
  const result = await pool.query(
    `WITH metrics AS (
       SELECT
         page_id,
         SUM(impressions)::int AS impressions,
         SUM(clicks)::int AS clicks
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
  return result.rows[0] || null;
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

async function resetOwners(websiteId: string) {
  await pool.query(
    `UPDATE pages
     SET canonical_owner = false,
         parent_intent_page_id = NULL,
         support_role = CASE
           WHEN primary_intent = 'COMPARISON_INTENT' THEN 'COMPARISON_PAGE'
           WHEN primary_intent = 'PRICING_INTENT' THEN 'PRICING_PAGE'
           WHEN primary_intent IN ('CASE_STUDY_INTENT', 'RESULTS_INTENT') THEN 'PROOF_PAGE'
           WHEN primary_intent = 'DEFINITION_INTENT' THEN 'DEFINITION_PAGE'
           WHEN primary_intent = 'FAQ_INTENT' THEN 'FAQ_PAGE'
           WHEN primary_intent IN ('TOOL_INTENT', 'CALCULATOR_INTENT') THEN 'UTILITY_PAGE'
           ELSE support_role
         END,
         updated_at = NOW()
     WHERE website_id = $1::text
       AND status = 'published'
       AND (canonical_owner = true OR parent_intent_page_id IS NOT NULL)`,
    [websiteId],
  );
}

async function selectOwners(websiteId: string, minClusterSize: number, limit: number, dryRun: boolean, resetExisting: boolean) {
  console.log("\n[intent-pipeline] OWNERS starting", { minClusterSize, limit, dryRun, resetExisting });

  if (resetExisting && !dryRun) {
    console.log("[intent-pipeline] resetting existing owners");
    await resetOwners(websiteId);
  }

  const clusters = await getClusters(websiteId, minClusterSize, limit);
  console.log(`[intent-pipeline] clusters=${clusters.length}`);

  let selected = 0;
  for (const cluster of clusters) {
    const candidate = await getBestCandidate(websiteId, cluster.intent_cluster);
    if (!candidate) continue;
    selected++;
    console.log(`[intent-pipeline] owner ${selected}/${clusters.length}: ${cluster.intent_cluster} pages=${cluster.page_count} owner=${candidate.slug} score=${candidate.rank_score}`);
    if (!dryRun) await setClusterOwner(websiteId, cluster.intent_cluster, candidate.id);
  }

  console.log(`[intent-pipeline] OWNERS done selected=${selected} dryRun=${dryRun}`);
}

async function main() {
  const args = parseArgs();
  if (!args.websiteId) throw new Error("Missing required --websiteId=<id>");

  console.log(`[intent-pipeline] website=${args.websiteId}`);
  console.log("[intent-pipeline] options", args);
  console.log("[intent-pipeline] before", await stats(args.websiteId));

  if (args.phase === "audit") {
    await audit(args.websiteId);
    return;
  }

  if (args.phase === "all" || args.phase === "backfill") {
    await backfillAll(args.websiteId, args.batchSize, args.dryRun, args.reclassify);
  }

  if (args.phase === "all" || args.phase === "owners") {
    await selectOwners(args.websiteId, args.minClusterSize, args.ownerLimit, args.dryRun, args.resetOwners);
  }

  await audit(args.websiteId);
  console.log("[intent-pipeline] after", await stats(args.websiteId));
}

main()
  .catch((err) => {
    console.error("[intent-pipeline] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
