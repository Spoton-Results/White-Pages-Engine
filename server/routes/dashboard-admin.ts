import { Router } from "express";
import { pool } from "../db"; // ✅ CHANGED: import pool for raw SQL queries
import { requireSuperAdmin } from "../auth";

const router = Router();

// ✅ CHANGED: GET /api/dashboard/stats
// Previously missing — Overview page KPI cards all showed "—" because this
// endpoint returned 404, which was silently swallowed by .catch(() => ({})).
router.get("/api/dashboard/stats", requireSuperAdmin, async (req, res) => {
  try {
    const [
      accountsRes,
      websitesRes,
      brandsRes,
      industriesRes,
      publishedRes,
      draftRes,
      activeJobsRes,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM accounts`),
      pool.query(`SELECT COUNT(*)::int AS count FROM websites`),
      pool.query(`SELECT COUNT(*)::int AS count FROM brand_profiles`),
      pool.query(`SELECT COUNT(*)::int AS count FROM industries`),
      pool.query(`SELECT COUNT(*)::int AS count FROM pages WHERE status = 'published'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM pages WHERE status = 'failed_qa'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM generation_jobs WHERE status = 'running'`),
    ]);

    return res.json({
      totalAccounts:      accountsRes.rows[0]?.count     ?? 0,
      totalWebsites:      websitesRes.rows[0]?.count     ?? 0,
      totalBrandProfiles: brandsRes.rows[0]?.count       ?? 0,
      totalIndustries:    industriesRes.rows[0]?.count   ?? 0,
      publishedPages:     publishedRes.rows[0]?.count    ?? 0,
      draftPages:         draftRes.rows[0]?.count        ?? 0,
      activeJobs:         activeJobsRes.rows[0]?.count   ?? 0,
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
});

// ✅ CHANGED: GET /api/dashboard/activity
// Previously missing — Overview page "Recent Jobs" and "Recent Pages" panels
// showed "No generation jobs yet" / "No pages yet" because this endpoint
// returned 404, silently swallowed by .catch(() => ({})).
router.get("/api/dashboard/activity", requireSuperAdmin, async (req, res) => {
  try {
    const [jobsRes, pagesRes] = await Promise.all([
      pool.query(`
        SELECT id, name, status,
               total_pages, processed_pages, passed_pages,
               created_at
        FROM generation_jobs
        ORDER BY created_at DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT id, title, status, page_type, updated_at
        FROM pages
        ORDER BY updated_at DESC
        LIMIT 10
      `),
    ]);

    return res.json({
      recentJobs: jobsRes.rows.map((j: any) => ({
        id:             j.id,
        name:           j.name,
        status:         j.status,
        totalPages:     j.total_pages     ?? 0,
        processedPages: j.processed_pages ?? 0,
        passedPages:    j.passed_pages    ?? 0,
        createdAt:      j.created_at,
      })),
      recentPages: pagesRes.rows.map((p: any) => ({
        id:       p.id,
        title:    p.title,
        status:   p.status,
        pageType: p.page_type,
        updatedAt: p.updated_at,
      })),
    });
  } catch (error) {
    console.error("Error fetching dashboard activity:", error);
    return res.status(500).json({ error: "Failed to fetch dashboard activity" });
  }
});

// 🔒 UNTOUCHED: GET /api/dashboard/admin/dashboard/accounts
router.get("/dashboard/accounts", requireSuperAdmin, async (req, res) => {
  try {
    const allAccountsRes = await pool.query(
      `SELECT id, name FROM accounts`
    );
    const allAccounts: { id: string; name: string }[] = allAccountsRes.rows;

    const accountsWithMetrics = await Promise.all(
      allAccounts.map(async (account) => {
        const [sitesRes, callsRes, formsRes, jobsRes] = await Promise.all([
          pool.query(
            `SELECT id FROM websites WHERE account_id = $1`,
            [account.id]
          ),
          pool.query(
            `SELECT COUNT(*)::int AS count FROM tracked_calls
             WHERE website_id IN (SELECT id FROM websites WHERE account_id = $1)`,
            [account.id]
          ),
          pool.query(
            `SELECT COUNT(*)::int AS count FROM tracked_leads
             WHERE website_id IN (SELECT id FROM websites WHERE account_id = $1)`,
            [account.id]
          ),
          pool.query(
            `SELECT job_value FROM booked_jobs WHERE account_id = $1`,
            [account.id]
          ),
        ]);

        const totalJobValue = jobsRes.rows.reduce(
          (sum: number, j: any) => sum + parseFloat(j.job_value ?? "0"),
          0
        );

        return {
          id: account.id,
          name: account.name,
          totalCalls: sitesRes.rows.length > 0 ? (callsRes.rows[0]?.count ?? 0) : 0,
          totalForms: sitesRes.rows.length > 0 ? (formsRes.rows[0]?.count ?? 0) : 0,
          totalJobsBooked: jobsRes.rows.length,
          totalJobValue: Math.round(totalJobValue * 100) / 100,
          websites: sitesRes.rows.length,
        };
      }),
    );

    return res.json({
      totalAccounts: accountsWithMetrics.length,
      accounts: accountsWithMetrics,
    });
  } catch (error) {
    console.error("Error fetching accounts:", error);
    return res.status(500).json({ error: "Failed to fetch accounts" });
  }
});

// 🔒 UNTOUCHED: GET /api/dashboard/admin/dashboard/revenue-summary
router.get("/dashboard/revenue-summary", requireSuperAdmin, async (req, res) => {
  try {
    const jobsRes = await pool.query(
      `SELECT job_value FROM booked_jobs`
    );
    const jobs = jobsRes.rows;
    const total = jobs.reduce((sum: number, j: any) => sum + parseFloat(j.job_value ?? "0"), 0);

    return res.json({
      totalJobsAcrossAllAccounts: jobs.length,
      totalJobValue: Math.round(total * 100) / 100,
      avgJobValue:
        jobs.length > 0 ? Math.round((total / jobs.length) * 100) / 100 : 0,
    });
  } catch (error) {
    console.error("Error fetching revenue summary:", error);
    return res.status(500).json({ error: "Failed to fetch revenue summary" });
  }
});

export default router;
