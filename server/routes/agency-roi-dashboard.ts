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

function accountScope(req: any, alias = "a") {
  return req.session.isSuperAdmin ? { clause: "", params: [] as any[] } : { clause: `WHERE ${alias}.id = $1`, params: [req.session.accountId] as any[] };
}

function accountAnd(req: any, alias = "a") {
  return req.session.isSuperAdmin ? { clause: "", params: [] as any[] } : { clause: `AND ${alias}.id = $1`, params: [req.session.accountId] as any[] };
}

router.get("/api/agency-dashboard/summary", async (req, res, next) => {
  try {
    const scope = accountScope(req, "a");
    const andScope = accountAnd(req, "a");

    const [clients, pages, cities, services] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM accounts a ${scope.clause}`, scope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id = p.website_id JOIN accounts a ON a.id = w.account_id WHERE p.status = 'published' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(DISTINCT l.slug)::int AS count FROM locations l JOIN accounts a ON a.id = l.account_id WHERE l.type = 'city' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(DISTINCT s.slug)::int AS count FROM services s JOIN accounts a ON a.id = s.account_id ${scope.clause}`, scope.params),
    ]);

    const activeClients = clients.rows[0]?.count ?? 0;
    const pagesLive = pages.rows[0]?.count ?? 0;
    const citiesCovered = cities.rows[0]?.count ?? 0;
    const servicesCovered = services.rows[0]?.count ?? 0;

    res.json({ activeClients, pagesLive, citiesCovered, servicesCovered, estimatedSearchReach: searchReachEstimate(pagesLive, citiesCovered, servicesCovered) });
  } catch (err) { next(err); }
});

router.get("/api/agency-dashboard/activity", async (req, res, next) => {
  try {
    const andScope = accountAnd(req, "a");

    const [pagesGenerated, pagesImproved, linksAdded, sitemapUpdates, qualityFixes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id = p.website_id JOIN accounts a ON a.id = w.account_id WHERE p.created_at >= NOW() - INTERVAL '30 days' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM generation_jobs gj JOIN accounts a ON a.id = gj.account_id WHERE gj.created_at >= NOW() - INTERVAL '30 days' AND gj.settings->>'type' = 'intent_page_improvement' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM internal_links il JOIN websites w ON w.id = il.website_id JOIN accounts a ON a.id = w.account_id WHERE il.created_at >= NOW() - INTERVAL '30 days' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM sitemaps sm JOIN websites w ON w.id = sm.website_id JOIN accounts a ON a.id = w.account_id WHERE sm.updated_at >= NOW() - INTERVAL '30 days' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT COUNT(*)::int AS count FROM operational_logs ol LEFT JOIN accounts a ON a.id = ol.account_id WHERE ol.created_at >= NOW() - INTERVAL '30 days' AND ol.level IN ('warning','error') ${andScope.clause}`, andScope.params),
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
  } catch (err) { next(err); }
});

router.get("/api/agency-dashboard/coverage", async (req, res, next) => {
  try {
    const andScope = accountAnd(req, "a");

    const [states, cities, pageTypes, opportunities] = await Promise.all([
      pool.query(`SELECT l.state_code, COUNT(*)::int AS cities FROM locations l JOIN accounts a ON a.id = l.account_id WHERE l.type = 'city' AND l.state_code IS NOT NULL ${andScope.clause} GROUP BY l.state_code ORDER BY cities DESC LIMIT 50`, andScope.params),
      pool.query(`SELECT COUNT(DISTINCT l.slug)::int AS count FROM locations l JOIN accounts a ON a.id = l.account_id WHERE l.type = 'city' ${andScope.clause}`, andScope.params),
      pool.query(`SELECT p.page_type, COUNT(*)::int AS count FROM pages p JOIN websites w ON w.id = p.website_id JOIN accounts a ON a.id = w.account_id WHERE p.status = 'published' ${andScope.clause} GROUP BY p.page_type`, andScope.params),
      pool.query(`SELECT l.name, l.state_code, l.population FROM locations l JOIN accounts a ON a.id = l.account_id WHERE l.type = 'city' ${andScope.clause} ORDER BY COALESCE(l.population,0) DESC LIMIT 10`, andScope.params),
    ]);

    const byType = Object.fromEntries(pageTypes.rows.map((r: any) => [r.page_type, r.count]));
    const cityCount = cities.rows[0]?.count ?? 0;
    const maxOpportunityCities = Math.max(cityCount + 1000, 1000);

    res.json({
      statesCovered: states.rows.length,
      citiesCovered: cityCount,
      cityCoveragePercentage: Math.min(100, Math.round((cityCount / maxOpportunityCities) * 100)),
      stateCoverage: states.rows,
      pageTypes: { stateHubs: byType.state_hub || 0, cityHubs: byType.city_hub || 0, cityService: byType.service_city || 0, industryCity: byType.industry_city || 0, problemIntent: byType.problem_intent || 0 },
      expansionOpportunities: opportunities.rows.map((r: any) => ({ city: r.name, state: r.state_code, reason: "High-population market already loaded; expand service-intent coverage.", population: r.population })),
    });
  } catch (err) { next(err); }
});

router.get("/api/agency-dashboard/clients", async (req, res, next) => {
  try {
    const scope = accountScope(req, "a");

    const result = await pool.query(
      `WITH page_counts AS (
         SELECT w.account_id, COUNT(p.id)::int AS pages_live,
                COUNT(CASE WHEN p.created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS pages_30d
         FROM websites w
         LEFT JOIN pages p ON p.website_id = w.id AND p.status = 'published'
         GROUP BY w.account_id
       ),
       city_counts AS (
         SELECT account_id, COUNT(DISTINCT slug)::int AS cities_covered
         FROM locations
         WHERE type = 'city'
         GROUP BY account_id
       ),
       service_counts AS (
         SELECT account_id, COUNT(DISTINCT slug)::int AS services_covered
         FROM services
         GROUP BY account_id
       ),
       link_counts AS (
         SELECT w.account_id, COUNT(il.id)::int AS links_30d
         FROM websites w
         LEFT JOIN internal_links il ON il.website_id = w.id AND il.created_at >= NOW() - INTERVAL '30 days'
         GROUP BY w.account_id
       ),
       job_counts AS (
         SELECT account_id,
           COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' AND settings->>'type' = 'intent_page_improvement' THEN 1 END)::int AS improvements_30d,
           COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS jobs_30d,
           COUNT(CASE WHEN status = 'failed' AND created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS failed_jobs_30d
         FROM generation_jobs
         GROUP BY account_id
       ),
       sitemap_counts AS (
         SELECT w.account_id, COUNT(CASE WHEN sm.updated_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS sitemap_updates_30d
         FROM websites w
         LEFT JOIN sitemaps sm ON sm.website_id = w.id
         GROUP BY w.account_id
       )
       SELECT a.id, a.name, a.status,
              COALESCE(pc.pages_live,0)::int AS pages_live,
              COALESCE(cc.cities_covered,0)::int AS cities_covered,
              COALESCE(sc.services_covered,0)::int AS services_covered,
              COALESCE(pc.pages_30d,0)::int AS pages_30d,
              COALESCE(lc.links_30d,0)::int AS links_30d,
              COALESCE(jc.improvements_30d,0)::int AS improvements_30d,
              COALESCE(jc.jobs_30d,0)::int AS jobs_30d,
              COALESCE(jc.failed_jobs_30d,0)::int AS failed_jobs_30d,
              COALESCE(smc.sitemap_updates_30d,0)::int AS sitemap_updates_30d,
              MAX(w.updated_at) AS last_activity_at
       FROM accounts a
       LEFT JOIN websites w ON w.account_id = a.id
       LEFT JOIN page_counts pc ON pc.account_id = a.id
       LEFT JOIN city_counts cc ON cc.account_id = a.id
       LEFT JOIN service_counts sc ON sc.account_id = a.id
       LEFT JOIN link_counts lc ON lc.account_id = a.id
       LEFT JOIN job_counts jc ON jc.account_id = a.id
       LEFT JOIN sitemap_counts smc ON smc.account_id = a.id
       ${scope.clause}
       GROUP BY a.id, a.name, a.status, pc.pages_live, pc.pages_30d, cc.cities_covered, sc.services_covered, lc.links_30d, jc.improvements_30d, jc.jobs_30d, jc.failed_jobs_30d, smc.sitemap_updates_30d
       ORDER BY COALESCE(pc.pages_live,0) DESC, a.name ASC
       LIMIT 250`,
      scope.params,
    );

    res.json(result.rows.map((r: any) => {
      const estimatedSearchReach = searchReachEstimate(r.pages_live, r.cities_covered, r.services_covered);
      const work30d = r.pages_30d + r.links_30d + r.improvements_30d + r.sitemap_updates_30d;
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        pagesLive: r.pages_live,
        citiesCovered: r.cities_covered,
        servicesCovered: r.services_covered,
        estimatedSearchReach,
        last30DaysWork: work30d,
        last30Days: {
          pagesGenerated: r.pages_30d,
          linksAdded: r.links_30d,
          pagesImproved: r.improvements_30d,
          sitemapUpdates: r.sitemap_updates_30d,
          jobsCompletedOrQueued: r.jobs_30d,
          failedJobs: r.failed_jobs_30d,
        },
        lastActivityAt: r.last_activity_at,
      };
    }));
  } catch (err) { next(err); }
});

export default router;
