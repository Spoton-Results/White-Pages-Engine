import { Router } from "express";
import { db, pool } from "../db"; // ✅ CHANGED: added pool for raw SQL read queries
import { trackedLeads, bookedJobs } from "@shared/schema";
import { eq, and, gte, lt, desc, inArray } from "drizzle-orm"; // 🔒 UNTOUCHED: used for inserts
import { requireAuth } from "../auth";
import { sendLeadNotification } from "../services/lead-notify";

const router = Router();

// 30-second cache for account-level leads (keyed by accountId:month)
const leadsCache = new Map<string, { data: unknown; exp: number }>();
function getCachedLeads(key: string) {
  const e = leadsCache.get(key);
  if (!e || Date.now() > e.exp) { leadsCache.delete(key); return null; }
  return e.data;
}
function setCachedLeads(key: string, data: unknown) {
  leadsCache.set(key, { data, exp: Date.now() + 30_000 });
}

function wantsHtmlRedirect(req: any) {
  const accept = String(req.headers.accept || "");
  const contentType = String(req.headers["content-type"] || "");
  return contentType.includes("application/x-www-form-urlencoded") || accept.includes("text/html");
}

function safeReturnUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function redirectWithStatus(res: any, sourcePageUrl: unknown, status: "success" | "error") {
  const fallback = safeReturnUrl(sourcePageUrl);
  if (!fallback) return res.status(status === "success" ? 200 : 400).send(status === "success" ? "Thank you. Your request was received." : "Unable to submit this form.");
  const url = new URL(fallback);
  url.searchParams.set("lead", status);
  url.hash = "quote";
  return res.redirect(303, url.toString());
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

// POST /api/form-tracking/submit  (public — called from public-facing page forms)
// 🔒 UNTOUCHED: write path — Drizzle insert works fine
router.post("/submit", async (req, res) => {
  try {
    const {
      pageId,
      serviceId,
      locationId,
      websiteId,
      formName,
      submitterName,
      submitterEmail,
      submitterPhone,
      message,
      sourcePageUrl,
      sourcePageTitle,
    } = req.body;

    if (!pageId || !websiteId || !serviceId || !submitterEmail) {
      if (wantsHtmlRedirect(req)) return redirectWithStatus(res, sourcePageUrl, "error");
      return res.status(400).json({ error: "Missing required fields: pageId, serviceId, websiteId, submitterEmail" });
    }

    const [lead] = await db
      .insert(trackedLeads)
      .values({
        websiteId,
        pageId,
        serviceId,
        locationId: locationId || null,
        formName: formName || "Contact Form",
        submitterName: submitterName || null,
        submitterEmail,
        submitterPhone: submitterPhone || null,
        message: message || null,
        sourcePageUrl: sourcePageUrl || null,
        sourcePageTitle: sourcePageTitle || null,
        formTimestamp: new Date(),
      })
      .returning();

    sendLeadNotification({
      leadId: lead.id,
      websiteId: lead.websiteId,
      pageId: lead.pageId,
      submitterName: lead.submitterName,
      submitterEmail: lead.submitterEmail,
      submitterPhone: lead.submitterPhone,
      message: lead.message,
      formName: lead.formName,
      sourcePageUrl: lead.sourcePageUrl,
      sourcePageTitle: lead.sourcePageTitle,
      formTimestamp: lead.formTimestamp ?? new Date(),
    });

    if (wantsHtmlRedirect(req)) return redirectWithStatus(res, sourcePageUrl, "success");

    return res.json({
      success: true,
      leadId: lead.id,
      message: "Form submitted successfully",
    });
  } catch (error) {
    console.error("Error recording form:", error);
    if (wantsHtmlRedirect(req)) return redirectWithStatus(res, req.body?.sourcePageUrl, "error");
    return res.status(500).json({ error: "Failed to submit form" });
  }
});

// GET /api/form-tracking/leads/:websiteId
router.get("/leads/:websiteId", requireAuth, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const { month } = req.query as { month?: string };

    // ✅ CHANGED: raw SQL to fix Drizzle camelCase→snake_case bug in production
    let query = `SELECT * FROM tracked_leads WHERE website_id = $1`;
    const params: any[] = [websiteId];
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      params.push(new Date(year, monthNum - 1, 1));
      params.push(new Date(year, monthNum, 1));
      query += ` AND form_timestamp >= $2 AND form_timestamp < $3`;
    }
    query += ` ORDER BY form_timestamp DESC`;

    const leadsRes = await pool.query(query, params);
    const leads = leadsRes.rows.map(mapLeadRow);

    const page = leads.slice(0, 100);
    const leadIds = page.map((l) => l.id);
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
    const enriched = page.map((l) => ({ ...l, bookedJob: jobsByLeadId[l.id] ?? null }));

    return res.json({
      totalForms: leads.length,
      leads: enriched,
    });
  } catch (error) {
    console.error("Error fetching leads:", error);
    return res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// GET /api/form-tracking/account-leads?accountId=X&month=YYYY-MM&limit=100
router.get("/account-leads", requireAuth, async (req, res) => {
  try {
    const { accountId, month } = req.query as { accountId?: string; month?: string };
    if (!accountId) return res.status(400).json({ error: "accountId is required" });

    const cacheKey = `${accountId}:${month ?? "cur"}`;
    const cached = getCachedLeads(cacheKey);
    if (cached) return res.json(cached);

    // ✅ CHANGED: raw SQL for websites lookup (fixes account_id mapping bug)
    const siteRes = await pool.query(
      `SELECT id FROM websites WHERE account_id = $1`,
      [accountId]
    );
    const websiteIds = siteRes.rows.map((r: any) => r.id);
    if (!websiteIds.length) return res.json({ leads: [], totalForms: 0 });

    // ✅ CHANGED: raw SQL for tracked_leads (fixes website_id mapping bug)
    let query = `SELECT * FROM tracked_leads WHERE website_id = ANY($1)`;
    const params: any[] = [websiteIds];
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      params.push(new Date(year, monthNum - 1, 1));
      params.push(new Date(year, monthNum, 1));
      query += ` AND form_timestamp >= $2 AND form_timestamp < $3`;
    }
    query += ` ORDER BY form_timestamp DESC LIMIT 100`;

    const leadsRes = await pool.query(query, params);
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

    const payload = {
      totalForms: leads.length,
      leads: leads.map((l) => ({ ...l, bookedJob: jobsByLeadId[l.id] ?? null })),
    };
    setCachedLeads(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    console.error("Error fetching account leads:", error);
    return res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// GET /api/form-tracking/metrics/:websiteId
router.get("/metrics/:websiteId", requireAuth, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const { month } = req.query as { month?: string };

    // ✅ CHANGED: raw SQL to fix Drizzle camelCase→snake_case bug in production
    let query = `SELECT page_id, service_id FROM tracked_leads WHERE website_id = $1`;
    const params: any[] = [websiteId];
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      params.push(new Date(year, monthNum - 1, 1));
      params.push(new Date(year, monthNum, 1));
      query += ` AND form_timestamp >= $2 AND form_timestamp < $3`;
    }

    const formsRes = await pool.query(query, params);
    const forms = formsRes.rows.map((r: any) => ({
      pageId:    r.page_id,
      serviceId: r.service_id,
    }));

    const formsByPage: Record<string, number> = {};
    const formsByService: Record<string, number> = {};

    for (const form of forms) {
      formsByPage[form.pageId] = (formsByPage[form.pageId] ?? 0) + 1;
      formsByService[form.serviceId] = (formsByService[form.serviceId] ?? 0) + 1;
    }

    return res.json({
      totalForms: forms.length,
      formsByPage,
      formsByService,
      forms: forms.slice(0, 50),
    });
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

export default router;
