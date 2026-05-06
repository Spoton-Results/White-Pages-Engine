import { Router } from "express";
import { db } from "../db";
import { accounts, websites, trackedCalls, trackedLeads, bookedJobs } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { requireSuperAdmin } from "../auth";
import { createIntentBuildJob, getLatestIntentBuildJob } from "../services/intent-build-job";

const router = Router();

// GET /api/admin/dashboard/accounts
router.get("/dashboard/accounts", requireSuperAdmin, async (req, res) => {
  try {
    const allAccounts = await db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts);

    const accountsWithMetrics = await Promise.all(
      allAccounts.map(async (account) => {
        const siteRows = await db
          .select({ id: websites.id })
          .from(websites)
          .where(eq(websites.accountId, account.id));
        const websiteIds = siteRows.map((w) => w.id);

        const [callCount, formCount, jobRows] = await Promise.all([
          websiteIds.length > 0
            ? db
                .select()
                .from(trackedCalls)
                .where(inArray(trackedCalls.websiteId, websiteIds))
                .then((r) => r.length)
            : Promise.resolve(0),
          websiteIds.length > 0
            ? db
                .select()
                .from(trackedLeads)
                .where(inArray(trackedLeads.websiteId, websiteIds))
                .then((r) => r.length)
            : Promise.resolve(0),
          db.select().from(bookedJobs).where(eq(bookedJobs.accountId, account.id)),
        ]);

        const totalJobValue = jobRows.reduce(
          (sum, j) => sum + parseFloat(j.jobValue ?? "0"),
          0,
        );

        return {
          id: account.id,
          name: account.name,
          totalCalls: callCount,
          totalForms: formCount,
          totalJobsBooked: jobRows.length,
          totalJobValue: Math.round(totalJobValue * 100) / 100,
          websites: siteRows.length,
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
router.get("/dashboard/revenue-summary", requireSuperAdmin, async (req, res) => {
  try {
    const jobs = await db.select().from(bookedJobs);
    const total = jobs.reduce((sum, j) => sum + parseFloat(j.jobValue ?? "0"), 0);

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

// POST /api/admin/websites/:websiteId/intent-build/run
router.post("/websites/:websiteId/intent-build/run", requireSuperAdmin, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const result = await createIntentBuildJob(websiteId);
    return res.status(result.alreadyRunning ? 200 : 202).json(result);
  } catch (error: any) {
    console.error("[intent-build] run failed:", error);
    return res.status(500).json({ error: "Failed to start intent build", message: error?.message });
  }
});

// GET /api/admin/websites/:websiteId/intent-build/status
router.get("/websites/:websiteId/intent-build/status", requireSuperAdmin, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const job = await getLatestIntentBuildJob(websiteId);
    return res.json({ job });
  } catch (error: any) {
    console.error("[intent-build] status failed:", error);
    return res.status(500).json({ error: "Failed to fetch intent build status", message: error?.message });
  }
});

// GET /api/admin/websites/:websiteId/intent-build/report
router.get("/websites/:websiteId/intent-build/report", requireSuperAdmin, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const job = await getLatestIntentBuildJob(websiteId);
    return res.json({ job, report: job?.result_json ?? job?.resultJson ?? null });
  } catch (error: any) {
    console.error("[intent-build] report failed:", error);
    return res.status(500).json({ error: "Failed to fetch intent build report", message: error?.message });
  }
});

export default router;
