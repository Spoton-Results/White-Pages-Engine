import { Router } from "express";
import { pool } from "../db"; // ✅ CHANGED: removed unused db import
import { requireAuth } from "../auth";
import { querySiteAnalytics, getServiceAccountEmail } from "../services/gsc-search-console";

const router = Router();

// ── 5-minute server-side cache ───────────────────────────────────────────────
// 🔒 UNTOUCHED: cache logic preserved exactly
interface CacheEntry { data: unknown; expiresAt: number }
const summaryCache = new Map<string, CacheEntry>();
function getCached(key: string): unknown | null {
  const entry = summaryCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { summaryCache.delete(key); return null; }
  return entry.data;
}
function setCache(key: string, data: unknown, ttlMs = 300_000) {
  summaryCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// GET /api/dashboard/agency/:accountId
router.get("/agency/:accountId", requireAuth, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { month } = req.query as { month?: string };

    // 🔒 UNTOUCHED: date range logic preserved exactly
    let startDate: Date;
    let endDate: Date;
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      startDate = new Date(year, monthNum - 1, 1);
      endDate = new Date(year, monthNum, 1);
    } else {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    const cacheKey = `${accountId}:${month ?? "cur"}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // ── Step 1: account + websites in parallel ────────────────────────────────
    // 🔒 UNTOUCHED: already using raw pool.query()
    const [acctRes, siteQueryRes] = await Promise.all([
      pool.query(
        `SELECT name, COALESCE(monthly_seo_spend, 0)::float AS monthly_seo_spend FROM accounts WHERE id = $1 LIMIT 1`,
        [accountId],
      ),
      pool.query(
        `SELECT id, domain, COALESCE(settings, '{}') AS settings FROM websites WHERE account_id = $1`,
        [accountId],
      ),
    ]);

    const acct = acctRes.rows[0] ?? {};
    const monthlySpend: number = acct.monthly_seo_spend ?? 0;
    const siteRows = siteQueryRes.rows as Array<{ id: string; domain: string; settings: Record<string, any> }>;
    const websiteIds = siteRows.map((w) => w.id);

    // ── Step 2: calls / forms / jobs / SEO / GSC all in parallel ─────────────
    // ✅ CHANGED: replaced Drizzle db.select() for trackedCalls, trackedLeads, bookedJobs
    // with raw pool.query() to fix camelCase→snake_case bug causing empty metrics in production
    const GSC_TIMEOUT_MS = 1500;

    const [callRes, formRes, jobRes, seoRes, gscResults] = await Promise.all([
      websiteIds.length > 0
        ? pool.query(
            `SELECT page_id, service_id, call_duration_seconds
             FROM tracked_calls
             WHERE website_id = ANY($1)
               AND call_timestamp >= $2
               AND call_timestamp < $3`,
            [websiteIds, startDate, endDate],
          )
        : Promise.resolve({ rows: [] as any[] }),

      websiteIds.length > 0
        ? pool.query(
            `SELECT page_id, service_id
             FROM tracked_leads
             WHERE website_id = ANY($1)
               AND form_timestamp >= $2
               AND form_timestamp < $3`,
            [websiteIds, startDate, endDate],
          )
        : Promise.resolve({ rows: [] as any[] }),

      pool.query(
        `SELECT job_value
         FROM booked_jobs
         WHERE account_id = $1
           AND booked_date >= $2
           AND booked_date < $3`,
        [accountId, startDate, endDate],
      ),

      // 🔒 UNTOUCHED: already raw SQL
      websiteIds.length > 0
        ? pool.query(
            `SELECT tier,
                    COUNT(*)::int                                  AS cnt,
                    COALESCE(ROUND(AVG(quality_score)), 0)::int   AS avg_score
             FROM   pages
             WHERE  website_id = ANY($1) AND status = 'published'
             GROUP  BY tier
             ORDER  BY tier`,
            [websiteIds],
          )
        : Promise.resolve({ rows: [] as any[] }),

      // 🔒 UNTOUCHED: GSC logic preserved exactly
      Promise.all(
        siteRows.map(async (site) => {
          const gscSiteUrl: string | undefined = site.settings?.gscSiteUrl;
          if (!gscSiteUrl) return null;
          const data = await Promise.race([
            querySiteAnalytics(gscSiteUrl, startDate, endDate).catch(() => null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), GSC_TIMEOUT_MS)),
          ]);
          return { site, gscSiteUrl, data };
        }),
      ),
    ]);

    // ✅ CHANGED: map snake_case raw rows to camelCase field names used by aggregation below
    const callRows = callRes.rows.map((r: any) => ({
      pageId:              r.page_id,
      serviceId:           r.service_id,
      callDurationSeconds: r.call_duration_seconds,
    }));
    const formRows = formRes.rows.map((r: any) => ({
      pageId:    r.page_id,
      serviceId: r.service_id,
    }));
    const jobRows = jobRes.rows.map((r: any) => ({
      jobValue: r.job_value,
    }));

    // ── Aggregate calls ────────────────────────────────────────────────────────
    // 🔒 UNTOUCHED: aggregation logic preserved exactly
    const callsByPage: Record<string, number> = {};
    const callsByService: Record<string, number> = {};
    let totalCallDuration = 0;
    for (const call of callRows) {
      callsByPage[call.pageId] = (callsByPage[call.pageId] ?? 0) + 1;
      callsByService[call.serviceId] = (callsByService[call.serviceId] ?? 0) + 1;
      totalCallDuration += call.callDurationSeconds ?? 0;
    }
    const avgCallSeconds = callRows.length > 0 ? Math.round(totalCallDuration / callRows.length) : 0;
    const avgCallDuration = `${Math.floor(avgCallSeconds / 60)}m ${avgCallSeconds % 60}s`;

    // ── Aggregate forms ────────────────────────────────────────────────────────
    const formsByPage: Record<string, number> = {};
    const formsByService: Record<string, number> = {};
    for (const form of formRows) {
      formsByPage[form.pageId] = (formsByPage[form.pageId] ?? 0) + 1;
      formsByService[form.serviceId] = (formsByService[form.serviceId] ?? 0) + 1;
    }

    // ── Page title enrichment ─────────────────────────────────────────────────
    // 🔒 UNTOUCHED: already raw SQL
    const topPageIds = [
      ...Object.keys(callsByPage),
      ...Object.keys(formsByPage),
    ].filter(Boolean).slice(0, 20);

    const pageTitleMap: Record<string, string> = {};
    if (topPageIds.length > 0) {
      const ptRes = await pool.query(
        `SELECT id, title, slug FROM pages WHERE id = ANY($1)`,
        [topPageIds],
      );
      for (const row of ptRes.rows) {
        pageTitleMap[row.id] = row.title ?? row.slug ?? row.id.slice(0, 8) + "…";
      }
    }

    const topN = (obj: Record<string, number>, n = 5): [string, number][] =>
      Object.entries(obj)
        .sort(([, a], [, b]) => b - a)
        .slice(0, n)
        .map(([id, count]) => [pageTitleMap[id] || id.slice(0, 8) + "…", count]);

    // ── SEO Performance stats ─────────────────────────────────────────────────
    // 🔒 UNTOUCHED: SEO aggregation preserved exactly
    let seoTier1 = 0, seoTier2 = 0, seoTier3 = 0, seoTotal = 0, seoAvgScore = 0;
    let estImpressions = 0, estClicks = 0;
    let scoreSum = 0, pageCount = 0;
    for (const row of seoRes.rows) {
      seoTotal += row.cnt;
      if (row.tier === 1) {
        seoTier1 = row.cnt;
        estImpressions += row.cnt * 200;
        estClicks      += Math.round(row.cnt * 7);
      } else if (row.tier === 2) {
        seoTier2 = row.cnt;
        estImpressions += row.cnt * 30;
        estClicks      += Math.round(row.cnt * 0.4);
      } else {
        seoTier3 = row.cnt;
        estImpressions += row.cnt * 8;
      }
      scoreSum  += row.avg_score * row.cnt;
      pageCount += row.cnt;
    }
    seoAvgScore = pageCount > 0 ? Math.round(scoreSum / pageCount) : 0;

    // ── GSC aggregation ───────────────────────────────────────────────────────
    // 🔒 UNTOUCHED: GSC aggregation preserved exactly
    let gscImpressions = 0, gscClicks = 0;
    const gscPositions: number[] = [];
    let gscConnected = false;
    const gscSites: Array<{ websiteId: string; domain: string; siteUrl: string }> = [];

    for (const result of gscResults) {
      if (!result) continue;
      const { site, gscSiteUrl, data } = result;
      gscSites.push({ websiteId: site.id, domain: site.domain, siteUrl: gscSiteUrl });
      gscConnected = true;
      if (data) {
        gscImpressions += data.impressions;
        gscClicks      += data.clicks;
        if (data.avgPosition) gscPositions.push(data.avgPosition);
      }
    }

    const gscAvgPosition = gscPositions.length > 0
      ? Math.round(gscPositions.reduce((a, b) => a + b, 0) / gscPositions.length * 10) / 10
      : null;

    const saConfigured = !!getServiceAccountEmail();
    const unconfiguredSites = siteRows
      .filter((s) => !s.settings?.gscSiteUrl)
      .map((s) => ({ id: s.id, domain: s.domain, suggestedUrl: `https://${s.domain}/` }));

    // ── ROI Metrics ───────────────────────────────────────────────────────────
    // 🔒 UNTOUCHED: ROI math preserved exactly
    const totalLeads    = callRows.length + formRows.length;
    const totalJobValue = jobRows.reduce((sum, j) => sum + parseFloat(j.jobValue ?? "0"), 0);
    const avgJobValue   = jobRows.length > 0 ? Math.round((totalJobValue / jobRows.length) * 100) / 100 : 0;

    const cpl         = monthlySpend > 0 && totalLeads > 0     ? Math.round(monthlySpend / totalLeads) : null;
    const cpa         = monthlySpend > 0 && jobRows.length > 0  ? Math.round(monthlySpend / jobRows.length) : null;
    const roiMultiple = monthlySpend > 0 ? Math.round((totalJobValue / monthlySpend) * 10) / 10 : null;
    const netRevenue  = Math.round((totalJobValue - monthlySpend) * 100) / 100;

    // 🔒 UNTOUCHED: response payload shape preserved exactly
    const payload = {
      accountName: acct.name ?? "",
      calls: {
        thisMonth:   callRows.length,
        avgDuration: avgCallDuration,
        topPages:    topN(callsByPage),
        topServices: topN(callsByService),
      },
      forms: {
        thisMonth:      formRows.length,
        conversionRate: totalLeads > 0 ? `${Math.round((formRows.length / totalLeads) * 100)}%` : "0%",
        topPages:       topN(formsByPage),
        topServices:    topN(formsByService),
      },
      leads: {
        totalLeads,
        bookedJobs:    jobRows.length,
        totalJobValue: Math.round(totalJobValue * 100) / 100,
        avgJobValue,
      },
      monthlySummary: {
        calls:         callRows.length,
        forms:         formRows.length,
        bookedJobs:    jobRows.length,
        totalJobValue: Math.round(totalJobValue * 100) / 100,
      },
      seo: {
        total:          seoTotal,
        tier1:          seoTier1,
        tier2:          seoTier2,
        tier3:          seoTier3,
        avgScore:       seoAvgScore,
        estImpressions,
        estClicks,
        gsc: {
          connected:        gscConnected,
          saConfigured,
          impressions:      gscConnected ? gscImpressions : null,
          clicks:           gscConnected ? gscClicks      : null,
          avgPosition:      gscConnected ? gscAvgPosition : null,
          connectedSites:   gscSites,
          unconfiguredSites,
        },
      },
      roi: {
        monthlySpend,
        cpl,
        cpa,
        roiMultiple,
        netRevenue,
        totalJobValue: Math.round(totalJobValue * 100) / 100,
      },
    };

    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    return res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

export default router;
