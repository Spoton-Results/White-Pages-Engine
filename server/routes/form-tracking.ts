import { Router } from "express";
import { db } from "../db";
import { trackedLeads, bookedJobs } from "@shared/schema";
import { eq, and, gte, lt, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../auth";

const router = Router();

// POST /api/form-tracking/submit  (public — called from public-facing page forms)
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
      return res.status(400).json({ error: "Missing required fields: pageId, serviceId, websiteId, submitterEmail" });
    }

    const [lead] = await db
      .insert(trackedLeads)
      .values({
        websiteId,
        pageId,
        serviceId,
        locationId: locationId ?? null,
        formName: formName ?? "Contact Form",
        submitterName: submitterName ?? null,
        submitterEmail,
        submitterPhone: submitterPhone ?? null,
        message: message ?? null,
        sourcePageUrl: sourcePageUrl ?? null,
        sourcePageTitle: sourcePageTitle ?? null,
        formTimestamp: new Date(),
      })
      .returning();

    return res.json({
      success: true,
      leadId: lead.id,
      message: "Form submitted successfully",
    });
  } catch (error) {
    console.error("Error recording form:", error);
    return res.status(500).json({ error: "Failed to submit form" });
  }
});

// GET /api/form-tracking/leads/:websiteId
router.get("/leads/:websiteId", requireAuth, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const { month } = req.query as { month?: string };

    const conditions = [eq(trackedLeads.websiteId, websiteId)];
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      conditions.push(gte(trackedLeads.formTimestamp, new Date(year, monthNum - 1, 1)));
      conditions.push(lt(trackedLeads.formTimestamp, new Date(year, monthNum, 1)));
    }

    const leads = await db
      .select()
      .from(trackedLeads)
      .where(and(...conditions))
      .orderBy(desc(trackedLeads.formTimestamp));

    const page = leads.slice(0, 100);
    const leadIds = page.map((l) => l.id);
    const jobs =
      leadIds.length > 0
        ? await db.select().from(bookedJobs).where(inArray(bookedJobs.leadId, leadIds))
        : [];
    const jobsByLeadId: Record<string, (typeof jobs)[number]> = {};
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

// GET /api/form-tracking/metrics/:websiteId
router.get("/metrics/:websiteId", requireAuth, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const { month } = req.query as { month?: string };

    const conditions = [eq(trackedLeads.websiteId, websiteId)];
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      conditions.push(gte(trackedLeads.formTimestamp, new Date(year, monthNum - 1, 1)));
      conditions.push(lt(trackedLeads.formTimestamp, new Date(year, monthNum, 1)));
    }

    const forms = await db.select().from(trackedLeads).where(and(...conditions));

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
