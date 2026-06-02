import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();

type RoiInputs = {
  pagesLive: number;
  citiesCovered: number;
  servicesCovered: number;
  last30DaysWork: number;
  failedJobs: number;
  thinBanks: number;
};

function searchReachEstimate(pagesLive: number, citiesCovered: number, servicesCovered: number) {
  const base = pagesLive * 35;
  const cityBoost = citiesCovered * 120;
  const serviceBoost = servicesCovered * 450;
  return Math.round(base + cityBoost + serviceBoost);
}

function calculateRoiScore(input: RoiInputs) {
  let score = 0;
  if (input.pagesLive > 0) score += 25;
  if (input.pagesLive >= 100) score += 10;
  if (input.pagesLive >= 500) score += 10;
  if (input.citiesCovered > 0) score += 15;
  if (input.servicesCovered > 0) score += 15;
  if (input.last30DaysWork > 0) score += 20;
  score -= Math.min(input.failedJobs * 5, 20);
  score -= Math.min(input.thinBanks * 5, 20);
  return Math.max(0, Math.min(100, score));
}

function getChurnRiskFlags(input: RoiInputs) {
  const flags: string[] = [];
  if (input.pagesLive === 0) flags.push("No pages live");
  if (input.last30DaysWork === 0) flags.push("No work in 30 days");
  if (input.failedJobs > 0) flags.push("Failed jobs");
  if (input.thinBanks > 0) flags.push("Thin banks");
  if (input.citiesCovered < 3 || input.servicesCovered < 2) flags.push("Low coverage");
  return flags;
}

function getRecommendedNextAction(input: RoiInputs) {
  if (input.pagesLive === 0) return "Publish first page batch.";
  if (input.last30DaysWork === 0) return "Run generation or publish new batch.";
  if (input.failedJobs > 0) return "Review failed generation jobs.";
  if (input.thinBanks > 0) return "Fill missing variation sections.";
  return "Send monthly report to client.";
}

function accountScope(req: any, alias = "a") {
  return req.session.isSuperAdmin ? { clause: "", params: [] as any[] } : { clause: `WHERE ${alias}.id::text = $1::text`, params: [req.session.accountId] as any[] };
}

function accountAnd(req: any, alias = "a") {
  return req.session.isSuperAdmin ? { clause: "", params: [] as any[] } : { clause: `AND ${alias}.id::text = $1::text`, params: [req.session.accountId] as any[] };
}

async function assertClientAccess(req: any, res: any, accountId: string) {
  const result = await pool.query(`SELECT id, name, status FROM accounts WHERE id::text = $1::text LIMIT 1`, [accountId]);
  const account = result.rows[0];
  if (!account) {
    res.status(404).json({ message: "Client not found" });
    return null;
  }
  if (!req.session.isSuperAdmin && String(req.session.accountId) !== String(accountId)) {
    res.status(403).json({ message: "Forbidden: no access to this client" });
    return null;
  }
  return account;
}

async function ensureSearchConsoleTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS search_console_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    website_id UUID,
    property_url TEXT NOT NULL,
    site_url TEXT,
    connection_status TEXT NOT NULL DEFAULT 'not_connected',
    sitemap_submitted BOOLEAN NOT NULL DEFAULT false,
    indexed_pages INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    impressions INTEGER NOT NULL DEFAULT 0,
    average_position NUMERIC(10,2),
    coverage_warnings INTEGER NOT NULL DEFAULT 0,
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_search_console_properties_account ON search_console_properties(account_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_search_console_properties_website ON search_console_properties(website_id)`);
}

async function getSearchConsoleStatus(accountId: string) {
  await ensureSearchConsoleTables();
  const result = await pool.query(
    `SELECT scp.*, w.domain AS website_domain
     FROM search_console_properties scp
     LEFT JOIN websites w ON w.id::text = scp.website_id::text
     WHERE scp.account_id::text = $1::text
     ORDER BY COALESCE(scp.last_sync_at, scp.updated_at, scp.created_at) DESC
     LIMIT 1`,
    [accountId],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      connected: false,
      status: "not_connected",
      propertyUrl: null,
      websiteDomain: null,
      lastSyncAt: null,
      indexedPages: 0,
      clicks: 0,
      impressions: 0,
      averagePosition: null,
      sitemapSubmitted: false,
      coverageWarnings: 0,
      recommendedAction: "Connect Google Search Console property.",
    };
  }
  const connected = row.connection_status === "connected";
  return {
    connected,
    status: row.connection_status,
    propertyUrl: row.property_url,
    websiteDomain: row.website_domain || row.site_url,
    lastSyncAt: row.last_sync_at,
    indexedPages: Number(row.indexed_pages || 0),
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    averagePosition: row.average_position === null ? null : Number(row.average_position),
    sitemapSubmitted: !!row.sitemap_submitted,
    coverageWarnings: Number(row.coverage_warnings || 0),
    recommendedAction: connected ? (row.last_sync_at ? "Monitor search growth in monthly report." : "Run first Search Console sync.") : "Reconnect Google Search Console property.",
  };
}

router.get("/api/agency-dashboard/summary", requireAuth, async (req, res, next) => {
  try {
    const scope = accountScope(req, "a");
    const andScope = accountAnd(req, "a");
    const [clients, pages, pagesBuiltThisMonthRows, clientsWithNewWorkRows, cities, services, failedJobsRows, thinBankRows] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM accounts a ${scope.clause}`, scope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id::text = p.website_id::text JOIN accounts a ON a.id::text = w.account_id::text WHERE p.status = 'published' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id::text = p.website_id::text JOIN accounts a ON a.id::text = w.account_id::text WHERE p.status = 'published' AND p.created_at >= NOW() - INTERVAL '30 days' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(DISTINCT a.id)::int AS count FROM accounts a LEFT JOIN websites w ON w.account_id::text = a.id::text LEFT JOIN pages p ON p.website_id::text = w.id::text AND p.status = 'published' AND p.created_at >= NOW() - INTERVAL '30 days' LEFT JOIN generation_jobs gj ON gj.account_id::text = a.id::text AND gj.created_at >= NOW() - INTERVAL '30 days' LEFT JOIN internal_links il ON il.website_id::text = w.id::text AND il.created_at >= NOW() - INTERVAL '30 days' LEFT JOIN sitemaps sm ON sm.website_id::text = w.id::text AND sm.updated_at >= NOW() - INTERVAL '30 days' ${scope.clause} ${scope.clause ? "AND" : "WHERE"} (p.id IS NOT NULL OR gj.id IS NOT NULL OR il.id IS NOT NULL OR sm.id IS NOT NULL)`, scope.params),
      pool.query(`SELECT COUNT(DISTINCT l.slug)::int AS count FROM locations l JOIN accounts a ON a.id::text = l.account_id::text WHERE l.type = 'city' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(DISTINCT s.slug)::int AS count FROM services s JOIN accounts a ON a.id::text = s.account_id::text ${scope.clause}`, scope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM generation_jobs gj JOIN accounts a ON a.id::text = gj.account_id::text WHERE gj.status = 'failed' AND gj.created_at >= NOW() - INTERVAL '30 days' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM variation_bank_completeness vbc JOIN websites w ON w.id::text = vbc.website_id::text JOIN accounts a ON a.id::text = w.account_id::text WHERE vbc.completeness_score < 70 ${andScope.clause}`, andScope.params),
    ]);
    const activeClients = clients.rows[0]?.count ?? 0;
    const pagesLive = pages.rows[0]?.count ?? 0;
    const pagesBuiltThisMonth = pagesBuiltThisMonthRows.rows[0]?.count ?? 0;
    const clientsWithNewWork = clientsWithNewWorkRows.rows[0]?.count ?? 0;
    const citiesCovered = cities.rows[0]?.count ?? 0;
    const servicesCovered = services.rows[0]?.count ?? 0;
    const failedJobs = failedJobsRows.rows[0]?.count ?? 0;
    const thinBanks = thinBankRows.rows[0]?.count ?? 0;
    const clientsAtRisk = Math.min(activeClients, failedJobs + thinBanks + (pagesLive === 0 ? activeClients : 0));
    const reportsReady = clientsWithNewWork;
    res.json({ activeClients, pagesLive, pagesBuiltThisMonth, clientsWithNewWork, failedJobs, clientsAtRisk, reportsReady, citiesCovered, servicesCovered, estimatedSearchReach: searchReachEstimate(pagesLive, citiesCovered, servicesCovered) });
  } catch (err) { next(err); }
});

router.get("/api/agency-dashboard/activity", requireAuth, async (req, res, next) => {
  try {
    const andScope = accountAnd(req, "a");
    const [pagesGenerated, pagesImproved, linksAdded, sitemapUpdates, qualityFixes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id::text = p.website_id::text JOIN accounts a ON a.id::text = w.account_id::text WHERE p.created_at >= NOW() - INTERVAL '30 days' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM generation_jobs gj JOIN accounts a ON a.id::text = gj.account_id::text WHERE gj.created_at >= NOW() - INTERVAL '30 days' AND gj.settings->>'type' = 'intent_page_improvement' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM internal_links il JOIN websites w ON w.id::text = il.website_id::text JOIN accounts a ON a.id::text = w.account_id::text WHERE il.created_at >= NOW() - INTERVAL '30 days' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM sitemaps sm JOIN websites w ON w.id::text = sm.website_id::text JOIN accounts a ON a.id::text = w.account_id::text WHERE sm.updated_at >= NOW() - INTERVAL '30 days' ${andScope.clause}`, andScope.params),
      // ✅ CHANGED: added ::uuid cast on ol.account_id::text — column is varchar, accounts.id is uuid; without cast PG throws error 42883
      pool.query(`SELECT COUNT(*)::int AS count FROM operational_logs ol LEFT JOIN accounts a ON a.id::text = ol.account_id::text WHERE ol.created_at >= NOW() - INTERVAL '30 days' AND ol.level IN ('warning','error') ${andScope.clause}`, andScope.params),
    ]);
    res.json({ pagesGenerated: pagesGenerated.rows[0]?.count ?? 0, pagesImproved: pagesImproved.rows[0]?.count ?? 0, linksAdded: linksAdded.rows[0]?.count ?? 0, faqExpansions: pagesImproved.rows[0]?.count ?? 0, intentClustersBuilt: 0, sitemapUpdates: sitemapUpdates.rows[0]?.count ?? 0, contentRepairs: qualityFixes.rows[0]?.count ?? 0, qualityFixes: qualityFixes.rows[0]?.count ?? 0 });
  } catch (err) { next(err); }
});

router.get("/api/agency-dashboard/coverage", requireAuth, async (req, res, next) => {
  try {
    const andScope = accountAnd(req, "a");
    const [states, cities, pageTypes, opportunities] = await Promise.all([
      pool.query(`SELECT l.state_code, COUNT(*)::int AS cities FROM locations l JOIN accounts a ON a.id::text = l.account_id::text WHERE l.type = 'city' AND l.state_code IS NOT NULL ${andScope.clause} GROUP BY l.state_code ORDER BY cities DESC LIMIT 50`, andScope.params),
      pool.query(`SELECT COUNT(DISTINCT l.slug)::int AS count FROM locations l JOIN accounts a ON a.id::text = l.account_id::text WHERE l.type = 'city' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT p.page_type, COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id::text = p.website_id::text JOIN accounts a ON a.id::text = w.account_id::text WHERE p.status = 'published' ${andScope.clause} GROUP BY p.page_type`, andScope.params),
      pool.query(`SELECT l.name, l.state_code, l.population FROM locations l JOIN accounts a ON a.id::text = l.account_id::text WHERE l.type = 'city' ${andScope.clause} ORDER BY COALESCE(l.population,0) DESC LIMIT 10`, andScope.params),
    ]);
    const byType = Object.fromEntries(pageTypes.rows.map((r: any) => [r.page_type, r.count]));
    const cityCount = cities.rows[0]?.count ?? 0;
    const maxOpportunityCities = Math.max(cityCount + 1000, 1000);
    res.json({ statesCovered: states.rows.length, citiesCovered: cityCount, cityCoveragePercentage: Math.min(100, Math.round((cityCount / maxOpportunityCities) * 100)), stateCoverage: states.rows, pageTypes: { stateHubs: byType.state_hub || 0, cityHubs: byType.city_hub || 0, cityService: byType.service_city || 0, industryCity: byType.industry_city || 0, problemIntent: byType.problem_intent || 0 }, expansionOpportunities: opportunities.rows.map((r: any) => ({ city: r.name, state: r.state_code, reason: "High-population market already loaded; expand service-intent coverage.", population: r.population })) });
  } catch (err) { next(err); }
});

router.get("/api/agency-dashboard/clients", requireAuth, async (req, res, next) => {
  try {
    const scope = accountScope(req, "a");
    const result = await pool.query(
      `WITH page_counts AS (
         SELECT w.account_id::text AS account_id, COUNT(p.id)::int AS pages_live, COUNT(CASE WHEN p.created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS pages_30d
         FROM websites w LEFT JOIN pages p ON p.website_id::text = w.id::text AND p.status = 'published' GROUP BY w.account_id::text
       ), city_counts AS (
         SELECT account_id, COUNT(DISTINCT slug)::int AS cities_covered FROM locations WHERE type = 'city' GROUP BY account_id::text
       ), service_counts AS (
         SELECT account_id, COUNT(DISTINCT slug)::int AS services_covered FROM services GROUP BY account_id::text
       ), link_counts AS (
         SELECT w.account_id::text AS account_id, COUNT(il.id)::int AS links_30d FROM websites w LEFT JOIN internal_links il ON il.website_id::text = w.id::text AND il.created_at >= NOW() - INTERVAL '30 days' GROUP BY w.account_id::text
       ), job_counts AS (
         SELECT account_id, COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' AND settings->>'type' = 'intent_page_improvement' THEN 1 END)::int AS improvements_30d, COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS jobs_30d, COUNT(CASE WHEN status = 'failed' AND created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS failed_jobs_30d, MAX(created_at) AS last_job_date FROM generation_jobs GROUP BY account_id::text
       ), sitemap_counts AS (
         SELECT w.account_id::text AS account_id, COUNT(CASE WHEN sm.updated_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS sitemap_updates_30d FROM websites w LEFT JOIN sitemaps sm ON sm.website_id::text = w.id::text GROUP BY w.account_id::text
       ), thin_bank_counts AS (
         SELECT w.account_id::text AS account_id, COUNT(vbc.website_id)::int AS thin_banks FROM websites w LEFT JOIN variation_bank_completeness vbc ON vbc.website_id::text = w.id::text AND vbc.completeness_score < 70 GROUP BY w.account_id::text
       )
       SELECT a.id, a.name, a.status, COALESCE(pc.pages_live,0)::int AS pages_live, COALESCE(cc.cities_covered,0)::int AS cities_covered, COALESCE(sc.services_covered,0)::int AS services_covered, COALESCE(pc.pages_30d,0)::int AS pages_30d, COALESCE(lc.links_30d,0)::int AS links_30d, COALESCE(jc.improvements_30d,0)::int AS improvements_30d, COALESCE(jc.jobs_30d,0)::int AS jobs_30d, COALESCE(jc.failed_jobs_30d,0)::int AS failed_jobs_30d, COALESCE(tbc.thin_banks,0)::int AS thin_banks, COALESCE(smc.sitemap_updates_30d,0)::int AS sitemap_updates_30d, MAX(w.updated_at) AS last_activity_at, MAX(jc.last_job_date) AS last_job_date
       FROM accounts a LEFT JOIN websites w ON w.account_id::text = a.id::text LEFT JOIN page_counts pc ON pc.account_id::text = a.id::text LEFT JOIN city_counts cc ON cc.account_id::text = a.id::text LEFT JOIN service_counts sc ON sc.account_id::text = a.id::text LEFT JOIN link_counts lc ON lc.account_id::text = a.id::text LEFT JOIN job_counts jc ON jc.account_id::text = a.id::text LEFT JOIN sitemap_counts smc ON smc.account_id::text = a.id::text LEFT JOIN thin_bank_counts tbc ON tbc.account_id::text = a.id::text
       ${scope.clause}
       GROUP BY a.id, a.name, a.status, pc.pages_live, pc.pages_30d, cc.cities_covered, sc.services_covered, lc.links_30d, jc.improvements_30d, jc.jobs_30d, jc.failed_jobs_30d, jc.last_job_date, tbc.thin_banks, smc.sitemap_updates_30d
       ORDER BY COALESCE(pc.pages_live,0) DESC, a.name ASC LIMIT 250`,
      scope.params,
    );
    res.json(result.rows.map((r: any) => {
      const estimatedSearchReach = searchReachEstimate(r.pages_live, r.cities_covered, r.services_covered);
      const work30d = r.pages_30d + r.links_30d + r.improvements_30d + r.sitemap_updates_30d;
      const roiInput = { pagesLive: r.pages_live, citiesCovered: r.cities_covered, servicesCovered: r.services_covered, last30DaysWork: work30d, failedJobs: r.failed_jobs_30d, thinBanks: r.thin_banks };
      return { id: r.id, name: r.name, status: r.status, pagesLive: r.pages_live, citiesCovered: r.cities_covered, servicesCovered: r.services_covered, estimatedSearchReach, last30DaysWork: work30d, failedJobs: r.failed_jobs_30d, thinBanks: r.thin_banks, roiScore: calculateRoiScore(roiInput), churnRiskFlags: getChurnRiskFlags(roiInput), recommendedNextAction: getRecommendedNextAction(roiInput), pagesBuiltThisMonth: r.pages_30d, lastJobDate: r.last_job_date, last30Days: { pagesGenerated: r.pages_30d, linksAdded: r.links_30d, pagesImproved: r.improvements_30d, sitemapUpdates: r.sitemap_updates_30d, jobsCompletedOrQueued: r.jobs_30d, failedJobs: r.failed_jobs_30d }, lastActivityAt: r.last_activity_at };
    }));
  } catch (err) { next(err); }
});

router.get("/api/agency-dashboard/clients/:accountId", requireAuth, async (req, res, next) => {
  try {
    const account = await assertClientAccess(req, res, req.params.accountId);
    if (!account) return;
    const accountId = req.params.accountId;
    const [summaryRows, pageTypes, topCities, topServices, workLog, health, websites, searchConsole] = await Promise.all([
      pool.query(`SELECT (SELECT COUNT(*)::int FROM pages p JOIN websites w ON w.id::text = p.website_id::text WHERE w.account_id::text = $1::text AND p.status = 'published') AS pages_live, (SELECT COUNT(*)::int FROM pages p JOIN websites w ON w.id::text = p.website_id::text WHERE w.account_id::text = $1::text AND p.status = 'published' AND p.created_at >= NOW() - INTERVAL '30 days') AS pages_30d, (SELECT COUNT(DISTINCT slug)::int FROM locations WHERE account_id::text = $1::text AND type = 'city') AS cities_covered, (SELECT COUNT(DISTINCT slug)::int FROM services WHERE account_id::text = $1::text) AS services_covered`, [accountId]),
      pool.query(`SELECT p.page_type, COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id::text = p.website_id::text WHERE w.account_id::text = $1::text AND p.status = 'published' GROUP BY p.page_type ORDER BY count DESC`, [accountId]),
      pool.query(`SELECT name, state_code, population FROM locations WHERE account_id::text = $1::text AND type = 'city' ORDER BY COALESCE(population,0) DESC LIMIT 12`, [accountId]),
      pool.query(`SELECT s.name, s.slug, COUNT(p.id)::int AS pages_live FROM services s LEFT JOIN pages p ON p.service_id::text = s.id::text AND p.status = 'published' WHERE s.account_id::text = $1::text GROUP BY s.name, s.slug ORDER BY pages_live DESC, s.name ASC LIMIT 12`, [accountId]),
      pool.query(`SELECT 'page' AS type, p.title AS label, p.slug AS detail, p.created_at FROM pages p JOIN websites w ON w.id::text = p.website_id::text WHERE w.account_id::text = $1::text AND p.created_at >= NOW() - INTERVAL '30 days' UNION ALL SELECT 'job' AS type, gj.name AS label, gj.status::text AS detail, gj.created_at FROM generation_jobs gj WHERE gj.account_id::text = $1::text AND gj.created_at >= NOW() - INTERVAL '30 days' UNION ALL SELECT 'link' AS type, 'Internal link added' AS label, il.link_type AS detail, il.created_at FROM internal_links il JOIN websites w ON w.id::text = il.website_id::text WHERE w.account_id::text = $1::text AND il.created_at >= NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 30`, [accountId]),
      pool.query(`SELECT (SELECT COUNT(*)::int FROM generation_jobs WHERE account_id::text = $1::text AND status = 'failed' AND created_at >= NOW() - INTERVAL '30 days') AS failed_jobs, (SELECT COUNT(*)::int FROM generation_jobs WHERE account_id::text = $1::text AND status IN ('pending','running') AND created_at < NOW() - INTERVAL '30 minutes') AS stuck_jobs, (SELECT MAX(created_at) FROM generation_jobs WHERE account_id::text = $1::text) AS last_job_date, (SELECT COUNT(*)::int FROM variation_bank_completeness vbc JOIN websites w ON w.id::text = vbc.website_id::text WHERE w.account_id::text = $1::text AND vbc.completeness_score < 70) AS thin_banks`, [accountId]),
      pool.query(`SELECT id, name, domain, status, onboarding_status FROM websites WHERE account_id::text = $1::text ORDER BY created_at DESC`, [accountId]),
      getSearchConsoleStatus(accountId),
    ]);
    const s = summaryRows.rows[0] || { pages_live: 0, pages_30d: 0, cities_covered: 0, services_covered: 0 };
    const pagesLive = Number(s.pages_live || 0);
    const pagesBuiltThisMonth = Number(s.pages_30d || 0);
    const citiesCovered = Number(s.cities_covered || 0);
    const servicesCovered = Number(s.services_covered || 0);
    const healthRow = health.rows[0] || { failed_jobs: 0, stuck_jobs: 0, thin_banks: 0, last_job_date: null };
    const failedJobs = Number(healthRow.failed_jobs || 0);
    const thinBanks = Number(healthRow.thin_banks || 0);
    const last30DaysWork = workLog.rows.length;
    const roiInput = { pagesLive, citiesCovered, servicesCovered, last30DaysWork, failedJobs, thinBanks };
    const churnRiskFlags = getChurnRiskFlags(roiInput);
    const warnings = [...churnRiskFlags];
    if (Number(healthRow.stuck_jobs) > 0) warnings.push(`${healthRow.stuck_jobs} stuck jobs older than 30 minutes`);
    res.json({
      client: { id: account.id, name: account.name, status: account.status },
      summary: { pagesLive, pagesBuiltThisMonth, citiesCovered, servicesCovered, estimatedSearchReach: searchReachEstimate(pagesLive, citiesCovered, servicesCovered), roiScore: calculateRoiScore(roiInput), last30DaysWork, failedJobs, thinBanks, lastJobDate: healthRow.last_job_date, churnRiskFlags, recommendedNextAction: getRecommendedNextAction(roiInput) },
      searchConsole,
      websites: websites.rows,
      pageTypes: Object.fromEntries(pageTypes.rows.map((r: any) => [r.page_type || "unknown", r.count])),
      topCities: topCities.rows,
      topServices: topServices.rows,
      workLog: workLog.rows.map((r: any) => ({ type: r.type, label: r.label, detail: r.detail, createdAt: r.created_at })),
      expansionOpportunities: topCities.rows.slice(0, 8).map((r: any) => ({ city: r.name, state: r.state_code, reason: "Expand service and problem-intent coverage in this high-value market.", population: r.population })),
      health: { failedJobs, stuckJobs: Number(healthRow.stuck_jobs || 0), thinBanks, warnings, churnRiskFlags, recommendedNextAction: getRecommendedNextAction(roiInput), roiScore: calculateRoiScore(roiInput), lastJobDate: healthRow.last_job_date },
    });
  } catch (err) { next(err); }
});

export default router;
