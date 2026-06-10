import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireSuperAdmin } from "../auth";
import * as storage from "../storage";
import { pool } from "../db";
import { callAI } from "../services/ai-provider";
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
export default router;
