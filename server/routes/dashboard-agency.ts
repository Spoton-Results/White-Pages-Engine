import { Router } from "express";
import { db } from "../db";
import { websites, trackedCalls, trackedLeads, bookedJobs } from "@shared/schema";
import { eq, and, gte, lt, inArray } from "drizzle-orm";
import { requireAuth } from "../auth";

const router = Router();

// GET /api/dashboard/agency/:accountId
router.get("/agency/:accountId", requireAuth, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { month } = req.query as { month?: string };

    // Date range — default to current month
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

    const siteRows = await db
      .select({ id: websites.id })
      .from(websites)
      .where(eq(websites.accountId, accountId));
    const websiteIds = siteRows.map((w) => w.id);

    const callRows =
      websiteIds.length > 0
        ? await db
            .select()
            .from(trackedCalls)
            .where(
              and(
                inArray(trackedCalls.websiteId, websiteIds),
                gte(trackedCalls.callTimestamp, startDate),
                lt(trackedCalls.callTimestamp, endDate),
              ),
            )
        : [];

    const formRows =
      websiteIds.length > 0
        ? await db
            .select()
            .from(trackedLeads)
            .where(
              and(
                inArray(trackedLeads.websiteId, websiteIds),
                gte(trackedLeads.formTimestamp, startDate),
                lt(trackedLeads.formTimestamp, endDate),
              ),
            )
        : [];

    const jobRows = await db
      .select()
      .from(bookedJobs)
      .where(
        and(
          eq(bookedJobs.accountId, accountId),
          gte(bookedJobs.bookedDate, startDate),
          lt(bookedJobs.bookedDate, endDate),
        ),
      );

    // Aggregate calls
    const callsByPage: Record<string, number> = {};
    const callsByService: Record<string, number> = {};
    let totalCallDuration = 0;
    for (const call of callRows) {
      callsByPage[call.pageId] = (callsByPage[call.pageId] ?? 0) + 1;
      callsByService[call.serviceId] = (callsByService[call.serviceId] ?? 0) + 1;
      totalCallDuration += call.callDurationSeconds ?? 0;
    }
    const avgCallSeconds =
      callRows.length > 0 ? Math.round(totalCallDuration / callRows.length) : 0;
    const avgCallDuration = `${Math.floor(avgCallSeconds / 60)}m ${avgCallSeconds % 60}s`;

    // Aggregate forms
    const formsByPage: Record<string, number> = {};
    const formsByService: Record<string, number> = {};
    for (const form of formRows) {
      formsByPage[form.pageId] = (formsByPage[form.pageId] ?? 0) + 1;
      formsByService[form.serviceId] = (formsByService[form.serviceId] ?? 0) + 1;
    }

    const totalLeads = callRows.length + formRows.length;
    const totalJobValue = jobRows.reduce((sum, j) => sum + parseFloat(j.jobValue ?? "0"), 0);

    const topN = <T extends [string, number]>(obj: Record<string, number>, n = 5): T[] =>
      (Object.entries(obj).sort(([, a], [, b]) => b - a).slice(0, n) as T[]);

    return res.json({
      calls: {
        thisMonth: callRows.length,
        avgDuration: avgCallDuration,
        topPages: topN(callsByPage),
        topServices: topN(callsByService),
      },
      forms: {
        thisMonth: formRows.length,
        conversionRate:
          totalLeads > 0 ? `${Math.round((formRows.length / totalLeads) * 100)}%` : "0%",
        topPages: topN(formsByPage),
        topServices: topN(formsByService),
      },
      leads: {
        totalLeads,
        bookedJobs: jobRows.length,
        totalJobValue: Math.round(totalJobValue * 100) / 100,
        avgJobValue:
          jobRows.length > 0
            ? Math.round((totalJobValue / jobRows.length) * 100) / 100
            : 0,
      },
      monthlySummary: {
        calls: callRows.length,
        forms: formRows.length,
        bookedJobs: jobRows.length,
        totalJobValue: Math.round(totalJobValue * 100) / 100,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    return res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

export default router;
