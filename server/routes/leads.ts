import { Router } from "express";
import { db } from "../db";
import { trackedLeads, bookedJobs } from "@shared/schema";
import { eq, and, gte, lt, inArray, desc } from "drizzle-orm";
import { requireAuth } from "../auth";

const router = Router();

// Mounted at /api/leads in index.ts
// IMPORTANT: specific/static routes MUST be registered before dynamic /:param routes
// to prevent Express shadowing /update-status and /metrics/:accountId with /:websiteId.

// 30-second in-memory cache for metrics (keyed by accountId:month)
const metricsCache = new Map<string, { data: unknown; exp: number }>();
function getCachedMetrics(key: string) {
  const e = metricsCache.get(key);
  if (!e || Date.now() > e.exp) { metricsCache.delete(key); return null; }
  return e.data;
}
function setCachedMetrics(key: string, data: unknown) {
  metricsCache.set(key, { data, exp: Date.now() + 30_000 });
}

// POST /api/leads/update-status  ← registered FIRST (static path)
router.post("/update-status", requireAuth, async (req, res) => {
  try {
    const { leadId, status, jobValue, accountId } = req.body;

    if (!leadId || !status || !accountId) {
      return res.status(400).json({ error: "Missing required fields: leadId, status, accountId" });
    }

    const [lead] = await db
      .select()
      .from(trackedLeads)
      .where(eq(trackedLeads.id, leadId))
      .limit(1);

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    if ((status === "booked" || status === "closed_won") && jobValue != null) {
      const [bookedJob] = await db
        .insert(bookedJobs)
        .values({
          leadId,
          websiteId: lead.websiteId,
          pageId: lead.pageId,
          accountId,
          jobValue: String(parseFloat(jobValue)),
          bookedDate: new Date(),
          status: "recorded",
        })
        .returning();

      return res.json({
        success: true,
        leadId,
        status,
        bookedJobId: bookedJob.id,
        jobValue,
        message: "Job recorded successfully",
      });
    }

    return res.json({ success: true, leadId, status });
  } catch (error) {
    console.error("Error updating lead status:", error);
    return res.status(500).json({ error: "Failed to update lead status" });
  }
});

// GET /api/leads/metrics/:accountId  ← registered BEFORE /:websiteId (static segment first)
router.get("/metrics/:accountId", requireAuth, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { month } = req.query as { month?: string };

    const cacheKey = `${accountId}:${month ?? "cur"}`;
    const cached = getCachedMetrics(cacheKey);
    if (cached) return res.json(cached);

    const conditions = [eq(bookedJobs.accountId, accountId)];
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      conditions.push(gte(bookedJobs.bookedDate, new Date(year, monthNum - 1, 1)));
      conditions.push(lt(bookedJobs.bookedDate, new Date(year, monthNum, 1)));
    }

    const jobs = await db.select().from(bookedJobs).where(and(...conditions));
    const totalJobValue = jobs.reduce((sum, job) => sum + parseFloat(job.jobValue ?? "0"), 0);

    const payload = {
      totalJobsBooked: jobs.length,
      totalJobValue: Math.round(totalJobValue * 100) / 100,
      avgJobValue: jobs.length > 0 ? Math.round((totalJobValue / jobs.length) * 100) / 100 : 0,
      jobs,
    };
    setCachedMetrics(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

// GET /api/leads/:websiteId  ← dynamic param LAST so it doesn't shadow routes above
router.get("/:websiteId", requireAuth, async (req, res) => {
  try {
    const { websiteId } = req.params;

    const leads = await db
      .select()
      .from(trackedLeads)
      .where(eq(trackedLeads.websiteId, websiteId))
      .orderBy(desc(trackedLeads.formTimestamp));

    const leadIds = leads.map((l) => l.id);
    const jobs =
      leadIds.length > 0
        ? await db.select().from(bookedJobs).where(inArray(bookedJobs.leadId, leadIds))
        : [];

    const jobsByLeadId: Record<string, typeof jobs[number]> = {};
    for (const job of jobs) {
      if (job.leadId) jobsByLeadId[job.leadId] = job;
    }

    const enrichedLeads = leads.map((lead) => ({
      ...lead,
      bookedJob: jobsByLeadId[lead.id] ?? null,
    }));

    return res.json({ leads: enrichedLeads });
  } catch (error) {
    console.error("Error fetching leads:", error);
    return res.status(500).json({ error: "Failed to fetch leads" });
  }
});

export default router;
