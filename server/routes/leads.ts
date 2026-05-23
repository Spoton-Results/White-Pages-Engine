import { Router } from "express";
import { db, pool } from "../db"; // ✅ CHANGED: added pool for raw SQL queries
import { trackedLeads, bookedJobs } from "@shared/schema";
import { eq, and, gte, lt, desc } from "drizzle-orm"; // 🔒 UNTOUCHED: still used for insert/update ops
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

// Helper: map snake_case booked_jobs row to camelCase
function mapJobRow(r: any) {
  return {
    ...r,
    leadId:     r.lead_id,
    websiteId:  r.website_id,
    pageId:     r.page_id,
    accountId:  r.account_id,
    jobValue:   r.job_value,
    bookedDate: r.booked_date,
    createdAt:  r.created_at,
    updatedAt:  r.updated_at,
  };
}

// Helper: map snake_case tracked_leads row to camelCase
function mapLeadRow(r: any) {
  return {
    ...r,
    websiteId:       r.website_id,
    pageId:          r.page_id,
    serviceId:       r.service_id,
    locationId:      r.location_id,
    formName:        r.form_name,
    submitterName:   r.submitter_name,
    submitterEmail:  r.submitter_email,
    submitterPhone:  r.submitter_phone,
    sourcePageUrl:   r.source_page_url,
    sourcePageTitle: r.source_page_title,
    formTimestamp:   r.form_timestamp,
    createdAt:       r.created_at,
  };
}

// GET /api/leads  ← ALL leads across all websites (no websiteId filter)
router.get("/", requireAuth, async (_req, res) => {
  try {
    // ✅ CHANGED: raw SQL to fix Drizzle ORM camelCase→snake_case bug in production
    const leadsRes = await pool.query(
      `SELECT * FROM tracked_leads ORDER BY form_timestamp DESC`
    );
    const leads = leadsRes.rows.map(mapLeadRow);

    const leadIds = leads.map((l) => l.id);
    let jobs: any[] = [];
    if (leadIds.length > 0) {
      const jobsRes = await pool.query(
        `SELECT * FROM booked_jobs WHERE lead_id = ANY($1)`,
        [leadIds]
      );
      jobs = jobsRes.rows.map(mapJobRow);
    }

    const jobsByLeadId: Record<string, any> = {};
    for (const job of jobs) {
      if (job.leadId) jobsByLeadId[job.leadId] = job;
    }

    const enrichedLeads = leads.map((lead) => ({
      ...lead,
      bookedJob: jobsByLeadId[lead.id] ?? null,
    }));

    return res.json({ leads: enrichedLeads });
  } catch (error) {
    console.error("Error fetching all leads:", error);
    return res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// POST /api/leads/update-status  ← registered FIRST (static path)
// 🔒 UNTOUCHED: insert path uses Drizzle which works fine for writes
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

    // ✅ CHANGED: raw SQL to fix Drizzle camelCase→snake_case bug
    let query = `SELECT * FROM booked_jobs WHERE account_id = $1`;
    const params: any[] = [accountId];
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      params.push(new Date(year, monthNum - 1, 1));
      params.push(new Date(year, monthNum, 1));
      query += ` AND booked_date >= $2 AND booked_date < $3`;
    }

    const jobsRes = await pool.query(query, params);
    const jobs = jobsRes.rows.map(mapJobRow);
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

    // ✅ CHANGED: raw SQL to fix Drizzle camelCase→snake_case bug
    const leadsRes = await pool.query(
      `SELECT * FROM tracked_leads WHERE website_id = $1 ORDER BY form_timestamp DESC`,
      [websiteId]
    );
    const leads = leadsRes.rows.map(mapLeadRow);

    const leadIds = leads.map((l) => l.id);
    let jobs: any[] = [];
    if (leadIds.length > 0) {
      const jobsRes = await pool.query(
        `SELECT * FROM booked_jobs WHERE lead_id = ANY($1)`,
        [leadIds]
      );
      jobs = jobsRes.rows.map(mapJobRow);
    }

    const jobsByLeadId: Record<string, any> = {};
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
