import { pool } from "../server/db";
import {
  buildIntentCluster,
  funnelStageFromIntent,
  intentTypeFromPageType,
  riskFromOverlapScore,
  supportRoleFromIntent,
} from "../shared/intent-ownership";

type Args = {
  websiteId?: string;
  limit: number;
  batch: number;
  dryRun: boolean;
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

function parseArgs(): Args {
  const args: Args = { limit: 500, batch: 100, dryRun: false };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "websiteId") args.websiteId = value;
    if (key === "limit") args.limit = Math.max(1, Number(value || 500));
    if (key === "batch") args.batch = Math.max(1, Number(value || 100));
    if (key === "dryRun") args.dryRun = value !== "false";
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
  if (row.page_type === "state_hub" || row.page_type === "city_hub") return true;
  if (row.tier === 1) return true;
  return false;
}

function overlapRisk(row: PageRow): number {
  let score = 0;
  const slug = row.slug.toLowerCase();
  if (slug.includes("best-") || slug.includes("top-")) score += 15;
  if (slug.includes("pricing") || slug.includes("rates") || slug.includes("cost")) score += 10;
  if (slug.includes("services") && slug.includes("processing")) score += 10;
  if (row.page_type === "service_city") score += 10;
  if (row.quality_score && row.quality_score < 60) score += 20;
  if (row.trust_score && row.trust_score < 60) score += 10;
  return Math.max(0, Math.min(100, score));
}

async function getStats(websiteId?: string) {
  const params: any[] = [];
  const where = websiteId ? "WHERE website_id = $1::text" : "";
  if (websiteId) params.push(websiteId);

  const res = await pool.query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'published')::int AS published,
      COUNT(*) FILTER (WHERE primary_intent IS NOT NULL)::int AS with_primary_intent,
      COUNT(*) FILTER (WHERE intent_cluster IS NOT NULL)::int AS with_intent_cluster,
      COUNT(*) FILTER (WHERE canonical_owner = true)::int AS canonical_owners,
      COUNT(*) FILTER (WHERE cannibalization_risk IN ('HIGH', 'CRITICAL'))::int AS high_risk
     FROM pages
     ${where}`,
    params,
  );
  return res.rows[0];
}

async function getTargets(args: Args): Promise<PageRow[]> {
  const params: any[] = [];
  const where = ["p.status = 'published'"];

  if (args.websiteId) {
    params.push(args.websiteId);
    where.push(`p.website_id = $${params.length}::text`);
  }

  params.push(args.limit);
  const limitParam = params.length;

  const res = await pool.query(
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
       AND (p.primary_intent IS NULL OR p.intent_cluster IS NULL OR p.funnel_stage IS NULL)
     ORDER BY p.website_id ASC, p.page_type ASC, p.slug ASC
     LIMIT $${limitParam}::int`,
    params,
  );

  return res.rows;
}

async function main() {
  const args = parseArgs();
  console.log(`[intent-backfill] Starting Phase 1 backfill website=${args.websiteId || "all"}`);
  console.log(`[intent-backfill] Options: limit=${args.limit} batch=${args.batch} dryRun=${args.dryRun}`);
  console.log("[intent-backfill] Before:", await getStats(args.websiteId));

  const targets = await getTargets(args);
  console.log(`[intent-backfill] Found ${targets.length} target page(s)`);

  let processed = 0;
  let failed = 0;

  for (const row of targets) {
    try {
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

      if (!args.dryRun) {
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

      processed++;
      console.log(`[intent-backfill] ${processed}: ${row.page_type}/${row.slug} intent=${primaryIntent} cluster=${cluster} risk=${risk}`);
    } catch (err: any) {
      failed++;
      console.error(`[intent-backfill] failed ${row.id} ${row.slug}:`, err?.message || err);
    }
  }

  console.log("[intent-backfill] After:", await getStats(args.websiteId));
  console.log(`[intent-backfill] Done. processed=${processed} failed=${failed} dryRun=${args.dryRun}`);
}

main()
  .catch((err) => {
    console.error("[intent-backfill] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
