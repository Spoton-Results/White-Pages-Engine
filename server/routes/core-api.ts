import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { hashPassword, requireAuth, requireSuperAdmin } from "../auth";
import * as storage from "../storage";
import { pool } from "../db";
import { callAI } from "../services/ai-provider";
import { generateBlueprint } from "../services/claude";
import {
  insertAgencySchema,
  insertAccountSchema,
  insertWebsiteSchema,
  insertLocationSchema,
  insertServiceSchema,
  insertBrandProfileSchema,
  insertIndustrySchema,
  insertQueryClusterSchema,
  insertBlueprintSchema,
  insertPageSchema,
} from "@shared/schema";

const router = Router();

type BlueprintBulkJob = {
  jobId: string;
  accountId: string;
  total: number;
  done: number;
  created: number;
  skipped: number;
  failed: number;
  status: "pending" | "running" | "completed" | "failed";
  errors: Array<{ pageType: string; serviceName: string; message: string }>;
};

const blueprintBulkJobs = new Map<string, BlueprintBulkJob>();

const copySettingKeys = [
  "mainWebsiteUrl",
  "websiteUrl",
  "brandWebsiteUrl",
  "phone",
  "email",
  "ctaHeading",
  "ctaText",
  "ctaButtonLabel",
  "demoBannerUrl",
  "demoBannerHeading",
  "demoBannerSubtext",
  "demoBannerButtonLabel",
  "primaryColor",
  "brandName",
  "siteName",
  "businessName",
];

function pickPublicSettingsPatch(body: any) {
  const patch: Record<string, any> = {};
  for (const key of copySettingKeys) {
    if (Object.prototype.hasOwnProperty.call(body || {}, key)) patch[key] = body[key];
  }
  return patch;
}

async function propagatePublicWebsiteSettings(websiteId: string, body: any) {
  const settingsPatch = pickPublicSettingsPatch(body);
  if (Object.keys(settingsPatch).length === 0) return;

  const source = await pool.query(
    `SELECT id, account_id FROM websites WHERE id::text = $1::text LIMIT 1`,
    [websiteId],
  );
  const accountId = source.rows[0]?.account_id;
  if (!accountId) return;

  await pool.query(
    `UPDATE websites
     SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE account_id::text = $1::text`,
    [accountId, JSON.stringify(settingsPatch)],
  );

  await pool.query(
    `UPDATE pages
     SET r2_key = NULL,
         content_hash = NULL,
         rendered_at = NULL,
         updated_at = NOW()
     WHERE website_id IN (SELECT id FROM websites WHERE account_id::text = $1::text)
       AND status = 'published'`,
    [accountId],
  ).catch(() => {});
}

// ── Agencies ──────────────────────────────────────────────────────────────────
router.get("/api/agencies", requireAuth, async (_req: Request, res: Response) => {
  const agencies = await storage.getAgencies();
  return res.json(agencies);
});

router.post("/api/agencies", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = insertAgencySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const agency = await storage.createAgency(parsed.data);
  return res.status(201).json(agency);
});

router.put("/api/agencies/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const agency = await storage.updateAgency(req.params.id, req.body);
  if (!agency) return res.status(404).json({ message: "Agency not found" });
  return res.json(agency);
});

router.delete("/api/agencies/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  await storage.deleteAgency(req.params.id);
  return res.json({ message: "Agency deleted" });
});

// ── Accounts ─────────────────────────────────────────────────────────────────
router.get("/api/accounts", requireAuth, async (_req: Request, res: Response) => {
  const accounts = await storage.getAccounts();
  return res.json(accounts);
});

router.get("/api/accounts/:id", requireAuth, async (req: Request, res: Response) => {
  const account = await storage.getAccount(req.params.id);
  if (!account) return res.status(404).json({ message: "Account not found" });
  return res.json(account);
});

router.post("/api/accounts", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = insertAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const account = await storage.createAccount(parsed.data);
  return res.status(201).json(account);
});

router.put("/api/accounts/:id", requireAuth, async (req: Request, res: Response) => {
  const account = await storage.updateAccount(req.params.id, req.body);
  if (!account) return res.status(404).json({ message: "Account not found" });
  return res.json(account);
});

router.delete("/api/accounts/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  await storage.deleteAccount(req.params.id);
  return res.json({ message: "Account deleted" });
});

// ── Websites ─────────────────────────────────────────────────────────────────
router.get("/api/websites", requireAuth, async (req: Request, res: Response) => {
  const accountId = req.query.accountId as string | undefined;
  const websiteList = await storage.getWebsites(accountId);
  return res.json(websiteList);
});

router.get("/api/websites/:id", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.getWebsite(req.params.id);
  if (!website) return res.status(404).json({ message: "Website not found" });
  return res.json(website);
});

router.post("/api/websites", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertWebsiteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const website = await storage.createWebsite(parsed.data);
  return res.status(201).json(website);
});

router.put("/api/websites/:id", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.updateWebsite(req.params.id, req.body);
  if (!website) return res.status(404).json({ message: "Website not found" });

  // ✅ CHANGED: clear stale rendered artifacts so updated website settings appear live
  if (req.body?.settings) {
    await pool.query(
      `UPDATE pages
       SET r2_key = NULL,
           content_hash = NULL,
           rendered_at = NULL,
           updated_at = NOW()
       WHERE website_id::text = $1::text
         AND status = 'published'`,
      [req.params.id],
    ).catch((error) => {
      console.error("[websites/update] failed to invalidate rendered pages", error);
    });
  }

  return res.json(website);
});

// ✅ CHANGED: generate editable draft testimonials for empty website slots only
router.post("/api/websites/:id/generate-testimonials", requireAuth, async (req: Request, res: Response) => {
  try {
    const website = await storage.getWebsite(req.params.id);
    if (!website) return res.status(404).json({ message: "Website not found" });

    const existingTestimonials = Array.isArray(req.body?.existingTestimonials)
      ? req.body.existingTestimonials.slice(0, 5)
      : [];

    const emptyCount = Math.max(
      0,
      5 - existingTestimonials.filter((testimonial: any) =>
        String(testimonial?.quote || "").trim() ||
        String(testimonial?.name || "").trim() ||
        String(testimonial?.title || "").trim()
      ).length,
    );

    if (emptyCount === 0) {
      return res.json({ testimonials: [] });
    }

    const settings = (website as any).settings || {};
    const websiteName =
      String(req.body?.websiteName || website.name || settings.brandName || settings.businessName || "").trim();

    const prompt = `Create exactly ${emptyCount} short SAMPLE testimonial drafts for a website named "${websiteName || "this business"}".

These are placeholders for editorial review, not verified customer endorsements.

Rules:
- Return JSON only.
- Return an array of exactly ${emptyCount} objects.
- Each object must have: "quote", "name", "title".
- Keep each quote between 12 and 28 words.
- Do not invent revenue, percentages, rankings, dates, certifications, awards, or measurable results.
- Do not claim an actual transaction or real customer experience.
- Use clearly generic placeholder identities such as "Sample Customer" and role labels such as "Local Business Owner".
- Make each quote distinct and natural.
- Do not use markdown fences.

Required format:
[
  {
    "quote": "Example editable draft.",
    "name": "Sample Customer",
    "title": "Local Business Owner"
  }
]`;

    const ai = await callAI({
      prompt,
      maxTokens: 1200,
      temperature: 0.7,
    });

    const cleaned = ai.text
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");

    if (start === -1 || end === -1 || end <= start) {
      return res.status(502).json({ message: "AI returned an invalid testimonial response" });
    }

    const parsed = JSON.parse(cleaned.slice(start, end + 1));

    if (!Array.isArray(parsed)) {
      return res.status(502).json({ message: "AI returned an invalid testimonial list" });
    }

    const testimonials = parsed
      .slice(0, emptyCount)
      .map((testimonial: any) => ({
        quote: String(testimonial?.quote || "").trim(),
        name: String(testimonial?.name || "Sample Customer").trim(),
        title: String(testimonial?.title || "Customer").trim(),
        source: "ai-draft" as const,
      }))
      .filter((testimonial: any) => testimonial.quote);

    if (testimonials.length !== emptyCount) {
      return res.status(502).json({ message: "AI did not return all requested testimonial drafts" });
    }

    return res.json({ testimonials });
  } catch (error: any) {
    console.error("[websites/generate-testimonials]", error);
    return res.status(500).json({
      message: error?.message || "Failed to generate testimonial drafts",
    });
  }
});

router.delete("/api/websites/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  await storage.deleteWebsite(req.params.id);
  return res.json({ message: "Website deleted" });
});

router.put("/api/websites/:id/settings", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.updateWebsiteSettings(req.params.id, req.body);
  if (!website) return res.status(404).json({ message: "Website not found" });
  await propagatePublicWebsiteSettings(req.params.id, req.body).catch((err) => {
    console.error("[websites/settings] failed to propagate public settings", err);
  });
  return res.json(website);
});

// Delegate the rest of the restored core API by re-exporting fallback route mounting is unavailable in this patch.
// IMPORTANT: The file was intentionally truncated by this emergency patch would be unsafe.

// ✅ CHANGED: real Bulk Blueprint generation for non-comparison page types
router.post("/api/accounts/:accountId/blueprints/bulk-generate", requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({
    pageTypes: z.array(z.string().trim().min(1)).min(1, "Select at least one page type"),
    services: z.array(z.string()).min(1),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.message });
  }

  const pageTypes = [...new Set(parsed.data.pageTypes)];
  const services = [...new Set(parsed.data.services.map((service) => service.trim()))];

  if (pageTypes.includes("comparison")) {
    return res.status(400).json({
      message: "X vs Y comparisons require approved X, Y, and audience values. Use Generate with AI for comparison Blueprints.",
    });
  }

  const websiteList = await storage.getWebsites(req.params.accountId);
  const websiteId = websiteList[0]?.id;

  if (!websiteId) {
    return res.status(400).json({
      message: "This account needs a website before Blueprints can be generated.",
    });
  }

  const account = await storage.getAccount(req.params.accountId);
  const businessName = String(account?.name || "Business").trim();
  const industry = String((account as any)?.industry || "Business services").trim();

  const combinations = pageTypes.flatMap((pageType) =>
    services.map((serviceName) => ({ pageType, serviceName })),
  );

  const jobId = `bulk-bp-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const job: BlueprintBulkJob = {
    jobId,
    accountId: req.params.accountId,
    total: combinations.length,
    done: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    status: "pending",
    errors: [],
  };

  blueprintBulkJobs.set(jobId, job);

  setImmediate(async () => {
    job.status = "running";

    try {
      const existing = await storage.getBlueprints(req.params.accountId);
      const existingKeys = new Set(
        existing.map((blueprint: any) =>
          `${String(blueprint.pageType || "").trim().toLowerCase()}::${String(
            blueprint.name || "",
          ).trim().toLowerCase()}`,
        ),
      );

      for (const combination of combinations) {
        try {
          const generated = await generateBlueprint({
            businessName,
            industry,
            serviceName: combination.serviceName || undefined,
            pageType: combination.pageType,
          });

          const duplicateKey = `${combination.pageType.toLowerCase()}::${String(
            generated.name || "",
          ).trim().toLowerCase()}`;

          if (existingKeys.has(duplicateKey)) {
            job.skipped += 1;
            continue;
          }

          const validated = insertBlueprintSchema.safeParse({
            ...generated,
            accountId: req.params.accountId,
            websiteId,
          });

          if (!validated.success) {
            throw new Error(validated.error.message);
          }

          await storage.createBlueprint(validated.data);
          existingKeys.add(duplicateKey);
          job.created += 1;
        } catch (error: any) {
          job.failed += 1;
          job.errors.push({
            pageType: combination.pageType,
            serviceName: combination.serviceName,
            message: error?.message || "Generation failed",
          });
        } finally {
          job.done += 1;
        }
      }

      job.status = job.failed === job.total ? "failed" : "completed";
    } catch (error: any) {
      job.status = "failed";
      job.errors.push({
        pageType: "",
        serviceName: "",
        message: error?.message || "Bulk Blueprint generation failed",
      });
    }
  });

  return res.status(202).json({
    jobId,
    total: job.total,
    done: job.done,
    status: job.status,
    created: job.created,
    skipped: job.skipped,
    failed: job.failed,
  });
});

router.get("/api/accounts/:accountId/blueprints/bulk-job/:jobId", requireAuth, async (req: Request, res: Response) => {
  const job = blueprintBulkJobs.get(req.params.jobId);

  if (!job || job.accountId !== req.params.accountId) {
    return res.status(404).json({ message: "Bulk Blueprint job not found" });
  }

  return res.json(job);
});


// ✅ CHANGED: restore missing single Blueprint AI route used by the existing frontend

// ✅ CHANGED: restore missing account-scoped Blueprint save route

// ✅ CHANGED: restore missing individual Blueprint delete route
router.delete("/api/blueprints/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await storage.deleteBlueprint(req.params.id);
    return res.json({ message: "Blueprint deleted" });
  } catch (error: any) {
    console.error("[blueprints/delete]", error);
    return res.status(500).json({
      message: error?.message || "Failed to delete blueprint",
    });
  }
});

// ✅ CHANGED: restore missing account-scoped Delete All Blueprints route
router.delete("/api/accounts/:accountId/blueprints", requireAuth, async (req: Request, res: Response) => {
  try {
    const blueprints = await storage.getBlueprints(req.params.accountId);

    for (const blueprint of blueprints) {
      await storage.deleteBlueprint(blueprint.id);
    }

    return res.json({ count: blueprints.length });
  } catch (error: any) {
    console.error("[accounts/blueprints/delete-all]", error);
    return res.status(500).json({
      message: error?.message || "Failed to delete blueprints",
    });
  }
});

router.post("/api/accounts/:accountId/blueprints", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertBlueprintSchema.safeParse({
    ...req.body,
    accountId: req.params.accountId,
  });

  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.message,
    });
  }

  try {
    const blueprint = await storage.createBlueprint(parsed.data);
    return res.status(201).json(blueprint);
  } catch (error: any) {
    console.error("[accounts/blueprints/create]", error);
    return res.status(500).json({
      message: error?.message || "Failed to save blueprint",
    });
  }
});

router.post("/api/ai/generate-blueprint", requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({
    businessName: z.string().trim().min(1, "Business name is required"),
    industry: z.string().trim().min(1, "Industry is required"),
    serviceName: z.string().optional(),
    pageType: z.string().trim().min(1, "Page type is required"),
    extraContext: z.string().optional(),
    comparisonY: z.string().optional(),
    customComparisonY: z.string().optional(),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.message });
  }

  try {
    const blueprint = await generateBlueprint(parsed.data);
    return res.json(blueprint);
  } catch (error: any) {
    console.error("[ai/generate-blueprint]", error);
    return res.status(500).json({
      message: error?.message || "Failed to generate blueprint",
    });
  }
});


// ✅ CHANGED: restore Automation settings route

// ✅ CHANGED: restore Automation AI Suggest Settings route
router.post("/api/websites/:id/automation/ai-suggest", requireAuth, async (req: Request, res: Response) => {
  try {
    const website = await storage.getWebsite(req.params.id);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const { getAutomationSettings } = await import("../services/automation");
    const current = getAutomationSettings(website);

    const prompt = `You are configuring automation thresholds for a white-label SEO publishing platform.

Website:
- Name: ${website.name || "Unknown"}
- Domain: ${website.domain || "Unknown"}

Current settings:
${JSON.stringify(current, null, 2)}

Return JSON only with exactly these fields:
{
  "tier1Threshold": number,
  "tier2Threshold": number,
  "fallbackHitThreshold": number,
  "fallbackHitWindowDays": number,
  "autodemoteZeroImpressionDays": number,
  "thinBankThreshold": number,
  "reasoning": string
}

Rules:
- tier1Threshold: integer from 60 to 95
- tier2Threshold: integer from 30 to 79
- tier2Threshold must be lower than tier1Threshold
- fallbackHitThreshold: integer from 3 to 100
- fallbackHitWindowDays: integer from 7 to 90
- autodemoteZeroImpressionDays: integer from 30 to 180
- thinBankThreshold: integer from 40 to 90
- reasoning: one short paragraph explaining the recommendations
- Do not include markdown fences
- Do not include extra keys`;

    const ai = await callAI({
      prompt,
      maxTokens: 800,
      temperature: 0.2,
    });

    const cleaned = String(ai.text || "")
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      return res.status(502).json({ error: "AI returned an invalid recommendation" });
    }

    const parsed = JSON.parse(cleaned.slice(start, end + 1));

    const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.round(n)));
    };

    let tier1Threshold = clampInt(
      parsed.tier1Threshold,
      60,
      95,
      current.tier1Threshold,
    );

    let tier2Threshold = clampInt(
      parsed.tier2Threshold,
      30,
      79,
      current.tier2Threshold,
    );

    if (tier2Threshold >= tier1Threshold) {
      tier2Threshold = Math.max(30, tier1Threshold - 10);
    }

    return res.json({
      tier1Threshold,
      tier2Threshold,
      fallbackHitThreshold: clampInt(
        parsed.fallbackHitThreshold,
        3,
        100,
        current.fallbackHitThreshold,
      ),
      fallbackHitWindowDays: clampInt(
        parsed.fallbackHitWindowDays,
        7,
        90,
        current.fallbackHitWindowDays,
      ),
      autodemoteZeroImpressionDays: clampInt(
        parsed.autodemoteZeroImpressionDays,
        30,
        180,
        current.autodemoteZeroImpressionDays,
      ),
      thinBankThreshold: clampInt(
        parsed.thinBankThreshold,
        40,
        90,
        current.thinBankThreshold,
      ),
      reasoning: String(
        parsed.reasoning ||
        "These recommendations balance page quality, promotion speed, and conservative demotion safeguards."
      ).trim(),
    });
  } catch (error: any) {
    console.error("[automation/ai-suggest]", error);
    return res.status(500).json({
      error: error?.message || "Failed to generate automation recommendations",
    });
  }
});

router.get("/api/websites/:id/automation-settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const website = await storage.getWebsite(req.params.id);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const {
      getAutomationSettings,
      DEFAULT_AUTOMATION_SETTINGS,
    } = await import("../services/automation");

    return res.json({
      settings: getAutomationSettings(website),
      defaults: DEFAULT_AUTOMATION_SETTINGS,
    });
  } catch (error: any) {
    console.error("[automation/settings/get]", error);
    return res.status(500).json({
      error: error?.message || "Failed to load automation settings",
    });
  }
});

// ✅ CHANGED: restore Automation settings save route
router.put("/api/websites/:id/automation-settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const website = await storage.getWebsite(req.params.id);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const current = (website.settings as any) || {};
    const merged = {
      ...current,
      automation: {
        ...(current.automation || {}),
        ...req.body,
      },
    };

    const updated = await storage.updateWebsite(req.params.id, {
      settings: merged,
    } as any);

    const { getAutomationSettings } = await import("../services/automation");

    return res.json({
      ok: true,
      settings: getAutomationSettings(updated || { settings: merged }),
    });
  } catch (error: any) {
    console.error("[automation/settings/put]", error);
    return res.status(500).json({
      error: error?.message || "Failed to save automation settings",
    });
  }
});

// ✅ CHANGED: restore Automation notifications route
router.get("/api/websites/:id/notifications", requireAuth, async (req: Request, res: Response) => {
  try {
    const unreadOnly = req.query.unreadOnly === "true";
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10), 200);

    const notifications = await storage.getAdminNotifications(
      req.params.id,
      limit,
      unreadOnly,
    );
    const unreadCount = await storage.getUnreadNotificationCount(req.params.id);

    return res.json({ notifications, unreadCount });
  } catch (error: any) {
    console.error("[automation/notifications/get]", error);
    return res.status(500).json({
      error: error?.message || "Failed to load notifications",
    });
  }
});

// ✅ CHANGED: restore Automation notification read route
router.post("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
  try {
    await storage.markNotificationRead(req.params.id);
    return res.json({ ok: true });
  } catch (error: any) {
    console.error("[automation/notifications/read]", error);
    return res.status(500).json({
      error: error?.message || "Failed to mark notification as read",
    });
  }
});

// ✅ CHANGED: restore Automation promotion queue route
router.get("/api/websites/:id/promotion-queue", requireAuth, async (req: Request, res: Response) => {
  try {
    const website = await storage.getWebsite(req.params.id);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const { getAutomationSettings } = await import("../services/automation");
    const autoSettings = getAutomationSettings(website);

    const queue = await storage.getPromotionQueue(
      req.params.id,
      autoSettings.fallbackHitThreshold,
    );

    return res.json({ queue });
  } catch (error: any) {
    console.error("[automation/promotion-queue/get]", error);
    return res.status(500).json({
      error: error?.message || "Failed to load promotion queue",
    });
  }
});

// ✅ CHANGED: restore Automation promotion queue dismiss route
router.post("/api/websites/:id/promotion-queue/:logId/dismiss", requireAuth, async (req: Request, res: Response) => {
  try {
    await storage.markFallbackPromoted(req.params.logId);
    return res.json({ ok: true });
  } catch (error: any) {
    console.error("[automation/promotion-queue/dismiss]", error);
    return res.status(500).json({
      error: error?.message || "Failed to dismiss promotion queue item",
    });
  }
});

// ✅ CHANGED: restore Automation demotion logs route
router.get("/api/websites/:id/demotion-logs", requireAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10), 200);
    const logs = await storage.getDemotionLogs(req.params.id, limit);
    return res.json({ logs });
  } catch (error: any) {
    console.error("[automation/demotion-logs/get]", error);
    return res.status(500).json({
      error: error?.message || "Failed to load demotion logs",
    });
  }
});


// ✅ CHANGED: restore SEO Control score-unscored route
router.post("/api/websites/:id/score-pages", requireAuth, async (req: Request, res: Response) => {
  try {
    const websiteId = req.params.id;
    const website = await storage.getWebsite(websiteId);

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    res.json({ ok: true, message: "Scoring job started" });

    setImmediate(async () => {
      try {
        const { scorePageContent } = await import("../services/scoring");
        const blueprint = (website.settings as any)?.defaultBlueprintId
          ? await storage.getBlueprint((website.settings as any).defaultBlueprintId)
          : null;
        const minScoreForTier1 = (blueprint as any)?.minScoreForTier1 ?? 80;

        let processed = 0;
        const batchSize = 500;

        while (true) {
          const unscored = await storage.getUnscoredPages(websiteId, batchSize);
          if (unscored.length === 0) break;

          for (const page of unscored) {
            try {
              const version = await storage.getActivePageVersion(page.id);
              const banks = await storage.getVariationBanks(
                websiteId,
                page.title.split(" in ")[0] || "",
              );

              const result = scorePageContent(
                version?.contentHtml || "",
                page.metaDescription || "",
                page.title,
                page.wordCount || 0,
                banks,
                minScoreForTier1,
              );

              await storage.updatePageScore(
                page.id,
                result.total,
                result as any,
                result.recommendedTier,
              );

              processed += 1;
            } catch (error) {
              console.error("[score-pages/page]", page.id, error);
            }
          }

          if (unscored.length < batchSize) break;
        }

        console.log(
          `[score-pages] Done: scored ${processed} pages for website ${websiteId}`,
        );
      } catch (error) {
        console.error("[score-pages]", error);
      }
    });

    return;
  } catch (error: any) {
    console.error("[score-pages/start]", error);
    return res.status(500).json({
      error: error?.message || "Failed to start scoring",
    });
  }
});

// ✅ CHANGED: restore SEO Control combined score-and-promote route
router.post("/api/websites/:id/score-and-promote", requireAuth, async (req: Request, res: Response) => {
  try {
    const websiteId = req.params.id;
    const website = await storage.getWebsite(websiteId);

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    const parsed = z.object({
      tier1Threshold: z.number().min(0).max(100).default(80),
      tier3Threshold: z.number().min(0).max(100).default(55),
      applyTier3: z.boolean().default(false),
    }).safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }

    const {
      tier1Threshold,
      tier3Threshold,
      applyTier3,
    } = parsed.data;

    res.json({
      ok: true,
      message: "Score & Promote job started. Refresh stats in ~30s.",
    });

    setImmediate(async () => {
      try {
        const { scorePageContent } = await import("../services/scoring");
        const blueprint = (website.settings as any)?.defaultBlueprintId
          ? await storage.getBlueprint((website.settings as any).defaultBlueprintId)
          : null;
        const minScoreForTier1 = (blueprint as any)?.minScoreForTier1 ?? 80;

        let scored = 0;

        while (true) {
          const unscored = await storage.getUnscoredPages(websiteId, 500);
          if (unscored.length === 0) break;

          for (const page of unscored) {
            try {
              const version = await storage.getActivePageVersion(page.id);
              const banks = await storage.getVariationBanks(
                websiteId,
                page.title.split(" in ")[0] || "",
              );

              const result = scorePageContent(
                version?.contentHtml || "",
                page.metaDescription || "",
                page.title,
                page.wordCount || 0,
                banks,
                minScoreForTier1,
              );

              await storage.updatePageScore(
                page.id,
                result.total,
                result as any,
                result.recommendedTier,
              );

              scored += 1;
            } catch (error) {
              console.error("[score-and-promote/page]", page.id, error);
            }
          }

          if (unscored.length < 500) break;
        }

        const { promoted } = await storage.bulkUpdatePageTiers(
          websiteId,
          tier1Threshold,
        );

        let demoted = 0;

        if (applyTier3) {
          const result = await storage.bulkSetTier3(
            websiteId,
            tier3Threshold,
          );
          demoted = result.demoted;
        }

        console.log(
          `[score-and-promote] Done — scored:${scored} promoted:${promoted} demoted:${demoted}`,
        );
      } catch (error) {
        console.error("[score-and-promote]", error);
      }
    });

    return;
  } catch (error: any) {
    console.error("[score-and-promote/start]", error);
    return res.status(500).json({
      error: error?.message || "Failed to start score and promote",
    });
  }
});

// ✅ CHANGED: restore SEO Control apply-tiers route
router.post("/api/websites/:id/apply-tiers", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = z.object({
      tier1Threshold: z.number().min(0).max(100).default(80),
      tier3Threshold: z.number().min(0).max(100).default(55),
      applyTier3: z.boolean().default(false),
    }).safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }

    const websiteId = req.params.id;
    const website = await storage.getWebsite(websiteId);

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    const { promoted } = await storage.bulkUpdatePageTiers(
      websiteId,
      parsed.data.tier1Threshold,
    );

    let demoted = 0;

    if (parsed.data.applyTier3) {
      const result = await storage.bulkSetTier3(
        websiteId,
        parsed.data.tier3Threshold,
      );
      demoted = result.demoted;
    }

    return res.json({
      ok: true,
      promoted,
      demoted,
    });
  } catch (error: any) {
    console.error("[apply-tiers]", error);
    return res.status(500).json({
      error: error?.message || "Failed to apply tiers",
    });
  }
});

// ✅ CHANGED: restore SEO Control fallback promotion route
router.post("/api/websites/:id/fallback-hits/promote", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = z.object({
      slug: z.string().trim().min(1, "Slug is required"),
    }).safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }

    const website = await storage.getWebsite(req.params.id);

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    await storage.promoteFallbackSlug(
      req.params.id,
      parsed.data.slug,
    );

    return res.json({ ok: true });
  } catch (error: any) {
    console.error("[fallback-hits/promote]", error);
    return res.status(500).json({
      error: error?.message || "Failed to promote fallback slug",
    });
  }
});


// ✅ CHANGED: restore Users & Roles list route
router.get("/api/users", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const accounts = await storage.getAccounts();
    const accountNameById = new Map(
      accounts.map((account: any) => [account.id, account.name]),
    );

    const usersByAccount = await Promise.all(
      accounts.map((account: any) => storage.getUsersByAccount(account.id)),
    );

    const superAdmins = await storage.getSuperAdminUsers();
    const combined = [...superAdmins, ...usersByAccount.flat()];

    const seen = new Set<string>();
    const users = combined
      .filter((user: any) => {
        if (seen.has(user.id)) return false;
        seen.add(user.id);
        return true;
      })
      .map((user: any) => {
        const { password, ...safeUser } = user;
        return {
          ...safeUser,
          accountName: user.accountId
            ? accountNameById.get(user.accountId) || null
            : null,
        };
      });

    return res.json(users);
  } catch (error: any) {
    console.error("[users/list]", error);
    return res.status(500).json({
      message: error?.message || "Failed to load users",
    });
  }
});

// ✅ CHANGED: restore Users & Roles create route
router.post("/api/users", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = z.object({
    username: z.string().trim().min(1, "Username is required"),
    email: z.string().trim().email("Valid email is required"),
    password: z.string().min(1).default("changeme"),
    role: z.enum(["super_admin", "account_admin", "editor", "viewer"]),
    accountId: z.string().trim().min(1).optional(),
    isSuperAdmin: z.boolean().default(false),
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.message,
    });
  }

  const data = parsed.data;

  if (!data.isSuperAdmin && !data.accountId) {
    return res.status(400).json({
      message: "Account is required for non-super-admin users",
    });
  }

  try {
    const [existingUsername, existingEmail] = await Promise.all([
      storage.getUserByUsername(data.username),
      storage.getUserByEmail(data.email),
    ]);

    if (existingUsername) {
      return res.status(409).json({
        message: "Username already exists",
      });
    }

    if (existingEmail) {
      return res.status(409).json({
        message: "Email already exists",
      });
    }

    if (!data.isSuperAdmin && data.accountId) {
      const account = await storage.getAccount(data.accountId);
      if (!account) {
        return res.status(404).json({
          message: "Account not found",
        });
      }
    }

    const password = await hashPassword(data.password);

    const user = await storage.createUser({
      username: data.username,
      email: data.email,
      password,
      role: data.isSuperAdmin ? "super_admin" : data.role,
      accountId: data.isSuperAdmin ? null : data.accountId,
      isSuperAdmin: data.isSuperAdmin,
    });

    const { password: _password, ...safeUser } = user;

    return res.status(201).json(safeUser);
  } catch (error: any) {
    console.error("[users/create]", error);
    return res.status(500).json({
      message: error?.message || "Failed to create user",
    });
  }
});

export default router;

// Delete all pages for a website (keeps website, accounts, services, locations, blueprints)
router.delete("/api/websites/:websiteId/pages/purge", requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await storage.deleteAllPagesForWebsite(req.params.websiteId);
    return res.json({ message: "All pages deleted", deleted: { pages: deleted, sitemaps: 0 } });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});
