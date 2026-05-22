import { Router } from "express";
import { pool } from "../db"; // ✅ CHANGED: import pool for raw SQL queries
import { requireSuperAdmin } from "../auth";

const router = Router();

// GET /api/admin/dashboard/accounts
router.get("/dashboard/accounts", requireSuperAdmin, async (req, res) => {
  try {
    // ✅ CHANGED: use raw SQL to avoid Drizzle ORM camelCase→snake_case bug in production
    // (same pattern used by getAgencies, getAccounts, getWebsites, getDashboardStats in storage.ts)
    const allAccountsRes = await pool.query(
      `SELECT id, name FROM accounts`
    );
    const allAccounts: { id: string; name: string }[] = allAccountsRes.rows;

    const accountsWithMetrics = await Promise.all(
      allAccounts.map(async (account) => {
        // 🔒 UNTOUCHED: parallel fetch pattern preserved exactly
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

// GET /api/admin/dashboard/revenue-summary
// 🔒 UNTOUCHED: this route is left exactly as-is
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
