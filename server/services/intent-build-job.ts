import { pool } from "../db";
import {
  buildIntentCluster,
  funnelStageFromIntent,
  hasModifierIntentSlug,
  intentTypeFromPageType,
  riskFromOverlapScore,
  supportRoleFromIntent,
} from "../../shared/intent-ownership";

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

const runningInProcess = new Set<string>();

async function ensureIntentBuildJobsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intent_build_jobs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      website_id VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      status VARCHAR(30) NOT NULL DEFAULT 'queued',
      current_step TEXT,
      progress_percent INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      error_message TEXT,
      result_json JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_intent_build_jobs_website_created ON intent_build_jobs(website_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_intent_build_jobs_status ON intent_build_jobs(status)`);
}

async function updateJob(jobId: string, fields: Record<string, any>) {
  const entries = Object.entries(fields);
  if (!entries.length) return;
  const sets = entries.map(([key], index) => `${key} = $${index + 2}`).join(", ");
  await pool.query(
    `UPDATE intent_build_jobs SET ${sets}, updated_at = NOW() WHERE id = $1::text`,
    [jobId, ...entries.map(([, value]) => value)],
  );
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
  return intent === "STATE_HUB" || intent === "CITY_HUB" || intent === "REGION_HUB" || intent === "METRO_HUB";
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

async function ensureIntentColumns() {
  await pool.query(`ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS primary_intent TEXT,
    ADD COLUMN IF NOT EXISTS secondary_intent TEXT,
    ADD COLUMN IF NOT EXISTS intent_family TEXT,
    ADD COLUMN IF NOT EXISTS funnel_stage TEXT,
    ADD COLUMN IF NOT EXISTS canonical_owner BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS parent_intent_page_id VARCHAR,
    ADD COLUMN IF NOT EXISTS overlap_risk INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS semantic_distance NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS authority_weight INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS intent_cluster TEXT,
    ADD COLUMN IF NOT EXISTS support_role TEXT,
    ADD COLUMN IF NOT EXISTS cannibalization_risk TEXT NOT NULL DEFAULT 'LOW',
    ADD COLUMN IF NOT EXISTS intent_last_evaluated_at TIMESTAMP`);
}

async function getBackfillBatch(websiteId: string, limit: number): Promise<PageRow[]> {
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
     WHERE p.website_id = $1::text
       AND p.status = 'published'
       AND (p.primary_intent IS NULL OR p.intent_cluster IS NULL OR p.funnel_stage IS NULL)
     ORDER BY p.slug ASC
     LIMIT $2::int`,
    [websiteId, limit],
  );
  return result.rows;
}

async function classifyPages(websiteId: string, jobId: string, batchSize = 1000) {
  let total = 0;
  while (true) {
    const rows = await getBackfillBatch(websiteId, batchSize);
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
      total++;
    }
    await updateJob(jobId, { current_step: `Classified ${total} pages`, progress_percent: 45 });
  }
  return total;
}

async function getClusters(websiteId: string, minClusterSize: number) {
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
     ORDER BY page_count DESC, intent_cluster ASC`,
    [websiteId, minClusterSize],
  );
  return result.rows as { intent_cluster: string; page_count: number }[];
}

async function getBestCandidate(websiteId: string, intentCluster: string) {
  const result = await pool.query(
    `WITH metrics AS (
       SELECT page_id, SUM(impressions)::int AS impressions, SUM(clicks)::int AS clicks
       FROM page_metrics
       GROUP BY page_id
     )
     SELECT p.id, p.slug,
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
     ORDER BY rank_score DESC, COALESCE(m.clicks, 0) DESC, COALESCE(m.impressions, 0) DESC, p.slug ASC
     LIMIT 1`,
    [websiteId, intentCluster],
  );
  return result.rows[0] as { id: string; slug: string; rank_score: string } | undefined;
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

async function selectOwners(websiteId: string, jobId: string, minClusterSize = 2) {
  const clusters = await getClusters(websiteId, minClusterSize);
  let selected = 0;
  for (const cluster of clusters) {
    const candidate = await getBestCandidate(websiteId, cluster.intent_cluster);
    if (!candidate) continue;
    await setClusterOwner(websiteId, cluster.intent_cluster, candidate.id);
    selected++;
    if (selected % 25 === 0) await updateJob(jobId, { current_step: `Selected ${selected}/${clusters.length} canonical owners`, progress_percent: 75 });
  }
  return { selected, eligibleClusters: clusters.length };
}

async function ownerCoverageReport(websiteId: string, minClusterSize = 2) {
  const coverage = await pool.query(
    `WITH cluster_stats AS (
       SELECT intent_cluster,
         COUNT(*)::int AS page_count,
         COUNT(*) FILTER (WHERE canonical_owner = true)::int AS owner_count,
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
       COUNT(*) FILTER (WHERE high_risk_pages > 0)::int AS high_risk_clusters
     FROM cluster_stats`,
    [websiteId, minClusterSize],
  );
  const topOwners = await pool.query(
    `SELECT p.intent_cluster, COUNT(all_pages.id)::int AS cluster_pages, p.slug AS owner_slug, p.primary_intent, p.authority_weight, p.quality_score
     FROM pages p
     JOIN pages all_pages ON all_pages.website_id = p.website_id AND all_pages.intent_cluster = p.intent_cluster AND all_pages.status = 'published'
     WHERE p.website_id = $1::text AND p.status = 'published' AND p.canonical_owner = true
     GROUP BY p.intent_cluster, p.slug, p.primary_intent, p.authority_weight, p.quality_score
     ORDER BY cluster_pages DESC, p.intent_cluster
     LIMIT 25`,
    [websiteId],
  );
  return { coverage: coverage.rows[0], topOwners: topOwners.rows };
}

export async function createIntentBuildJob(websiteId: string) {
  await ensureIntentBuildJobsTable();
  const existing = await pool.query(
    `SELECT * FROM intent_build_jobs
     WHERE website_id = $1::text AND status IN ('queued','running')
     ORDER BY created_at DESC LIMIT 1`,
    [websiteId],
  );
  if (existing.rows[0]) return { job: existing.rows[0], alreadyRunning: true };

  const created = await pool.query(
    `INSERT INTO intent_build_jobs (website_id, status, current_step, progress_percent)
     VALUES ($1::text, 'queued', 'Queued', 0)
     RETURNING *`,
    [websiteId],
  );
  const job = created.rows[0];
  setImmediate(() => runIntentBuildJob(job.id, websiteId).catch((err) => console.error("[intent-job] Fatal", err)));
  return { job, alreadyRunning: false };
}

export async function getLatestIntentBuildJob(websiteId: string) {
  await ensureIntentBuildJobsTable();
  const result = await pool.query(
    `SELECT * FROM intent_build_jobs WHERE website_id = $1::text ORDER BY created_at DESC LIMIT 1`,
    [websiteId],
  );
  return result.rows[0] || null;
}

export async function runIntentBuildJob(jobId: string, websiteId: string) {
  if (runningInProcess.has(websiteId)) return;
  runningInProcess.add(websiteId);
  try {
    await updateJob(jobId, { status: "running", current_step: "Ensuring schema", progress_percent: 5, started_at: new Date() });
    await ensureIntentColumns();

    await updateJob(jobId, { current_step: "Classifying pages", progress_percent: 20 });
    const classifiedNow = await classifyPages(websiteId, jobId);

    await updateJob(jobId, { current_step: "Selecting canonical owners", progress_percent: 60 });
    const ownerResult = await selectOwners(websiteId, jobId);

    await updateJob(jobId, { current_step: "Building final health report", progress_percent: 90 });
    const finalStats = await stats(websiteId);
    const report = await ownerCoverageReport(websiteId);
    const resultJson = { classifiedNow, ownerResult, finalStats, report };

    await updateJob(jobId, {
      status: "completed",
      current_step: "Completed",
      progress_percent: 100,
      finished_at: new Date(),
      result_json: JSON.stringify(resultJson),
    });
  } catch (err: any) {
    await updateJob(jobId, {
      status: "failed",
      current_step: "Failed",
      error_message: err?.message || String(err),
      finished_at: new Date(),
    });
    throw err;
  } finally {
    runningInProcess.delete(websiteId);
  }
}
