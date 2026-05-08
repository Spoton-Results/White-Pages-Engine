import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

function searchReachEstimate(pagesLive: number, citiesCovered: number, servicesCovered: number) {
  const base = pagesLive * 35;
  const cityBoost = citiesCovered * 120;
  const serviceBoost = servicesCovered * 450;
  return Math.round(base + cityBoost + serviceBoost);
}

router.get("/api/agency-dashboard/summary", async (req, res, next) => {
  try {
    const accountScope = req.session.isSuperAdmin ? "" : "WHERE a.id = $1";
    const params = req.session.isSuperAdmin ? [] : [req.session.accountId];

    const [clients, pages, cities, services] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM accounts a ${accountScope}`, params),
      pool.query(`SELECT COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id = p.website_id JOIN accounts a ON a.id = w.account_id ${accountScope ? accountScope + " AND" : "WHERE"} p.status = 'published'`, params),
      pool.query(`SELECT COUNT(DISTINCT l.slug)::int AS count FROM locations l JOIN accounts a ON a.id = l.account_id ${accountScope ? accountScope + " AND" : "WHERE"} l.type = 'city'`, params),
      pool.query(`SELECT COUNT(DISTINCT s.slug)::int AS count FROM services s JOIN accounts a ON a.id = s.account_id ${accountScope}`, params),
    ]);

    const activeClients = clients.rows[0]?.count ?? 0;
    const pagesLive = pages.rows[0]?.count ?? 0;
    const citiesCovered = cities.rows[0]?.count ?? 0;
    const servicesCovered = services.rows[0]?.count ?? 0;

    res.json({
      activeClients,
      pagesLive,
      citiesCovered,
      servicesCovered,
      estimatedSearchReach: searchReachEstimate(pagesLive, citiesCovered, servicesCovered),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/api/agency-dashboard/activity", async (req, res, next) => {
  try {
    const accountWhere = req.session.isSuperAdmin ? "" : "AND a.id = $1";
    const params = req.session.isSuperAdmin ? [] : [req.session.accountId];

    const [pagesGenerated, pagesImproved, linksAdded, sitemapUpdates, qualityFixes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id = p.website_id JOIN accounts a ON a.id = w.account_id WHERE p.created_at >= NOW() - INTERVAL '30 days' ${accountWhere}`, params),
      pool.query(`SELECT COUNT(*)::int AS count FROM generation_jobs gj JOIN accounts a ON a.id = gj.account_id WHERE gj.created_at >= NOW() - INTERVAL '30 days' AND gj.settings->>'type' = 'intent_page_improvement' ${accountWhere}`, params),
      pool.query(`SELECT COUNT(*)::int AS count FROM internal_links il JOIN websites w ON w.id = il.website_id JOIN accounts a ON a.id = w.account_id WHERE il.created_at >= NOW() - INTERVAL '30 days' ${accountWhere}`, params),
      pool.query(`SELECT COUNT(*)::int AS count FROM sitemaps sm JOIN websites w ON w.id = sm.website_id JOIN accounts a ON a.id = w.account_id WHERE sm.updated_at >= NOW() - INTERVAL '30 days' ${accountWhere}`, params),
      pool.query(`SELECT COUNT(*)::int AS count FROM operational_logs ol WHERE ol.created_at >= NOW() - INTERVAL '30 days' AND ol.level IN ('warning','error')`, []),
    ]);

    res.json({
      pagesGenerated: pagesGenerated.rows[0]?.count ?? 0,
      pagesImproved: pagesImproved.rows[0]?.count ?? 0,
      linksAdded: linksAdded.rows[0]?.count ?? 0,
      faqExpansions: pagesImproved.rows[0]?.count ?? 0,
      intentClustersBuilt: 0,
      sitemapUpdates: sitemapUpdates.rows[0]?.count ?? 0,
      contentRepairs: qualityFixes.rows[0]?.count ?? 0,
      qualityFixes: qualityFixes.rows[0]?.count ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/api/agency-dashboard/coverage", async (req, res, next) => {
  try {
    const accountWhere = req.session.isSuperAdmin ? "" : "AND a.id = $1";
    const params = req.session.isSuperAdmin ? [] : [req.session.accountId];

    const [states, cities, pageTypes, opportunities] = await Promise.all([
      pool.query(`SELECT l.state_code, COUNT(*)::int AS cities FROM locations l JOIN accounts a ON a.id = l.account_id WHERE l.type = 'city' AND l.state_code IS NOT NULL ${accountWhere} GROUP BY l.state_code ORDER BY cities DESC LIMIT 50`, params),
      pool.query(`SELECT COUNT(DISTINCT l.slug)::int AS count FROM locations l JOIN accounts a ON a.id = l.account_id WHERE l.type = 'city' ${accountWhere}`, params),
      pool.query(`SELECT p.page_type, COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id = p.website_id JOIN accounts a ON a.id = w.account_id WHERE p.status = 'published' ${accountWhere} GROUP BY p.page_type`, params),
      pool.query(`SELECT l.name, l.state_code, l.population FROM locations l JOIN accounts a ON a.id = l.account_id WHERE l.type = 'city' ${accountWhere} ORDER BY COALESCE(l.population,0) DESC LIMIT 10`, params),
    ]);

    const byType = Object.fromEntries(pageTypes.rows.map((r: any) => [r.page_type, r.count]));
    const cityCount = cities.rows[0]?.count ?? 0;
    const maxOpportunityCities = Math.max(cityCount + 1000, 1000);

    res.json({
      statesCovered: states.rows.length,
      citiesCovered: cityCount,
      cityCoveragePercentage: Math.min(100, Math.round((cityCount / maxOpportunityCities) * 100)),
      stateCoverage: states.rows,
      pageTypes: {
        stateHubs: byType.state_hub || 0,
        cityHubs: byType.city_hub || 0,
        cityService: byType.service_city || 0,
        industryCity: byType.industry_city || 0,
        problemIntent: byType.problem_intent || 0,
      },
      expansionOpportunities: opportunities.rows.map((r: any) => ({ city: r.name, state: r.state_code, reason: "High-population market already loaded; expand service-intent coverage.", population: r.population })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
