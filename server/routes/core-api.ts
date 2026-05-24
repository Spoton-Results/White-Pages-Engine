/**
 * core-api.ts
 *
 * All API routes that were living exclusively in the old routes.ts monolith
 * and were never wired into index.ts after the modular migration began.
 *
 * Covers:
 *   - /api/accounts
 *   - /api/agencies  (alias for /api/accounts — "agency" and "account" are the same entity)
 *   - /api/websites  (and nested /api/websites/:id/...)
 *   - /api/locations
 *   - /api/services
 *   - /api/brand-profiles
 *   - /api/industries
 *   - /api/blueprints
 *   - /api/query-clusters
 *   - /api/pages  (CRUD + publish/unpublish/reorder)
 *   - /api/generation-jobs
 *   - /api/generation
 *   - /api/variation-banks  (CRUD + fill-missing + bank-completeness + write + write-thin + fill-missing-all-job)
 *   - /api/variation-writer
 *   - /api/sitemaps
 *   - /api/public/contact
 *   - /health + /_health  (duplicated here as safety net)
 */

import { Router, type Request, type Response } from "express";
import { requireAuth, requireSuperAdmin, hashPassword } from "../auth";
import * as storage from "../storage";
import { db } from "../db";
import { eq as dEq, and as dAnd, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  insertAccountSchema,
  insertUserSchema,
  insertBrandProfileSchema,
  insertWebsiteSchema,
  insertLocationSchema,
  insertServiceSchema,
  insertIndustrySchema,
  insertQueryClusterSchema,
  insertBlueprintSchema,
  insertPageSchema,
  insertGenerationJobSchema,
  websites,
  pages,
} from "@shared/schema";
import { z } from "zod";
import { generateSitemapsForWebsite, generateRobotsTxt } from "../services/sitemap";
import {
  writeVariationsForService,
  fillMissingSectionsForService,
  type BrandContext,
} from "../services/variation-writer";
// ✅ CHANGED: import callAI for the ai-suggest route
import { callAI } from "../services/ai-provider";

// ── Cache invalidation stubs ──────────────────────────────────────────────────
// The old routes.ts monolith held in-memory Maps for sitemap and page caches.
// Those Maps no longer exist after the modular migration. These stubs are
// no-ops until a dedicated cache module is introduced.
function invalidateSitemapCache(_websiteId: string): void {
  // no-op: cache layer removed with routes.ts monolith
}
function invalidatePageCache(_websiteId: string, _slug: string): void {
  // no-op: cache layer removed with routes.ts monolith
}

// ── In-memory job store for background fill-missing-all jobs ─────────────────
interface FillMissingJob {
  jobId: string;
  websiteId: string;
  status: "running" | "completed" | "failed";
  totalPages: number;
  processedPages: number;
  errors: string[];
  startedAt: number;
}
const fillMissingJobs = new Map<string, FillMissingJob>();

// ── In-memory job store for background write-thin jobs ───────────────────────
interface WriteThinJob {
  jobId: string;
  websiteId: string;
  status: "running" | "done" | "error";
  total: number;
  done: number;
  errors: string[];
  startedAt: number;
}
const writeThinJobs = new Map<string, WriteThinJob>();

const router = Router();

// ── Health (safety net) ──────────────────────────────────────────────────────
router.get("/health", (_req, res) => res.status(200).json({ ok: true }));
router.get("/_health", (_req, res) => res.status(200).json({ ok: true }));

// ── Accounts ─────────────────────────────────────────────────────────────────
router.get("/api/accounts", requireAuth, async (req: Request, res: Response) => {
  const accounts = await storage.getAccounts();
  return res.json(accounts);
});

router.get("/api/accounts/:id", requireAuth, async (req: Request, res: Response) => {
  const account = await storage.getAccount(req.params.id);
  if (!account) return res.status(404).json({ message: "Account not found" });
  return res.json(account);
});

router.post("/api/accounts", requireAuth, async (req: Request, res: Response) => {
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

// Account users
router.get("/api/accounts/:accountId/users", requireAuth, async (req: Request, res: Response) => {
  const users = await storage.getAccountUsers(req.params.accountId);
  return res.json(users);
});

router.post("/api/accounts/:accountId/users", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertUserSchema.safeParse({ ...req.body, accountId: req.params.accountId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const { password, ...rest } = parsed.data as any;
  const hashedPassword = await hashPassword(password);
  const user = await storage.createUser({ ...rest, password: hashedPassword });
  const { password: _, ...safeUser } = user;
  return res.status(201).json(safeUser);
});

// ── Agencies (alias for Accounts — same entity, different UI label) ───────────
router.get("/api/agencies", requireAuth, async (_req: Request, res: Response) => {
  const accounts = await storage.getAccounts();
  return res.json(accounts);
});

router.get("/api/agencies/:id", requireAuth, async (req: Request, res: Response) => {
  const account = await storage.getAccount(req.params.id);
  if (!account) return res.status(404).json({ message: "Agency not found" });
  return res.json(account);
});

router.post("/api/agencies", requireAuth, async (req: Request, res: Response) => {
  const body = { ...req.body };
  const parsed = insertAccountSchema.safeParse(body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const account = await storage.createAccount(parsed.data);
  return res.status(201).json(account);
});

router.put("/api/agencies/:id", requireAuth, async (req: Request, res: Response) => {
  const account = await storage.updateAccount(req.params.id, req.body);
  if (!account) return res.status(404).json({ message: "Agency not found" });
  return res.json(account);
});

router.delete("/api/agencies/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  await storage.deleteAccount(req.params.id);
  return res.json({ message: "Agency deleted" });
});

// ── Websites ──────────────────────────────────────────────────────────────────
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

router.delete("/api/websites/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  await storage.deleteWebsite(req.params.id);
  return res.json({ message: "Website deleted" });
});

router.put("/api/websites/:id/settings", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.updateWebsiteSettings(req.params.id, req.body);
  if (!website) return res.status(404).json({ message: "Website not found" });
  return res.json(website);
});

// ── Locations ─────────────────────────────────────────────────────────────────
// ✅ CHANGED: storage.getLocations() takes accountId (not websiteId).
//   Resolve websiteId → accountId first so the DB query hits account_id correctly.
router.get("/api/websites/:websiteId/locations", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.getWebsite(req.params.websiteId);
  if (!website) return res.status(404).json({ message: "Website not found" });
  const accountId = website.accountId;
  if (!accountId) return res.json([]);
  const locations = await storage.getLocations(accountId);
  return res.json(locations);
});

// ✅ CHANGED: POST also needs accountId resolved from websiteId for the insert.
router.post("/api/websites/:websiteId/locations", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.getWebsite(req.params.websiteId);
  if (!website) return res.status(404).json({ message: "Website not found" });
  const accountId = website.accountId;
  if (!accountId) return res.status(400).json({ message: "Website has no associated account" });
  const parsed = insertLocationSchema.safeParse({ ...req.body, accountId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const location = await storage.createLocation(parsed.data);
  return res.status(201).json(location);
});

router.put("/api/locations/:id", requireAuth, async (req: Request, res: Response) => {
  // 🔒 UNTOUCHED: flat update by location id
  const location = await storage.updateLocation(req.params.id, req.body);
  if (!location) return res.status(404).json({ message: "Location not found" });
  return res.json(location);
});

router.delete("/api/locations/:id", requireAuth, async (req: Request, res: Response) => {
  // 🔒 UNTOUCHED
  await storage.deleteLocation(req.params.id);
  return res.json({ message: "Location deleted" });
});

// ✅ ADDED: Account-scoped location routes used by the LocationsPage tab.
//   NOTE: specific action routes (bulk, count, ai-suggest, load-standard) MUST be
//   registered BEFORE GET /api/accounts/:accountId/locations so Express does not
//   treat action path segments as :id params.

// GET  /api/accounts/:accountId/locations/count
router.get("/api/accounts/:accountId/locations/count", requireAuth, async (req: Request, res: Response) => {
  const { type, search, cityTier } = req.query as Record<string, string>;
  const count = await storage.countLocations(
    req.params.accountId,
    type || undefined,
    search || undefined,
    cityTier ? parseInt(cityTier) : undefined,
  );
  return res.json({ count });
});

// POST /api/accounts/:accountId/locations/bulk  ← THE BROKEN IMPORT ROUTE
router.post("/api/accounts/:accountId/locations/bulk", requireAuth, async (req: Request, res: Response) => {
  const { locations: items } = req.body as { locations?: any[] };
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "locations array is required and must not be empty" });
  }
  // Attach accountId to every item before passing to storage
  const withAccount = items.map((loc: any) => ({ ...loc, accountId: req.params.accountId }));
  // Validate each item — skip malformed rows, collect how many are skipped
  const validItems: any[] = [];
  let skipped = 0;
  for (const loc of withAccount) {
    const parsed = insertLocationSchema.safeParse(loc);
    if (parsed.success) {
      validItems.push(parsed.data);
    } else {
      skipped++;
    }
  }
  if (validItems.length === 0) {
    return res.status(400).json({ message: "No valid location rows found in payload", skipped });
  }
  // bulkCreateLocations deduplicates by slug and returns { inserted }
  const result = await storage.bulkCreateLocations(req.params.accountId, validItems);
  // Rows deduplicated by bulkCreateLocations count toward skipped too
  const dedupSkipped = validItems.length - result.inserted;
  return res.status(201).json({
    inserted: result.inserted,
    skipped: skipped + dedupSkipped,
  });
});

// POST /api/accounts/:accountId/locations/ai-suggest
router.post("/api/accounts/:accountId/locations/ai-suggest", requireAuth, async (req: Request, res: Response) => {
  const { stateCode, count: requestedCount } = req.body as { stateCode?: string; count?: number };
  if (!stateCode?.trim()) {
    return res.status(400).json({ message: "stateCode is required" });
  }
  try {
    const n = Math.min(requestedCount ?? 10, 50);
    const prompt = `You are a local SEO expert. List the top ${n} cities by population in the US state with abbreviation "${stateCode.toUpperCase()}". For each city provide its name, state code, approximate population, and a cityTier (1 = top 5 largest, 2 = mid-size, 3 = small).

Respond with ONLY valid JSON array:
[{"name":"City Name","stateCode":"XX","population":123456,"cityTier":1}]`;
    const aiResponse = await callAI({ prompt, maxTokens: 1200, temperature: 0.3 });
    const raw = aiResponse.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const suggestions = JSON.parse(raw) as any[];
    return res.json({ suggestions: Array.isArray(suggestions) ? suggestions : [] });
  } catch (err: any) {
    console.error("[locations/ai-suggest]", err);
    return res.status(500).json({ message: err.message ?? "AI suggestion failed" });
  }
});

// POST /api/accounts/:accountId/locations/load-standard
router.post("/api/accounts/:accountId/locations/load-standard", requireAuth, async (req: Request, res: Response) => {
  // Stub: a real implementation would seed from a bundled US cities dataset.
  // Returns the same shape as /bulk so the frontend can consume it uniformly.
  return res.json({ inserted: 0, skipped: 0, message: "Standard locations load not yet implemented — use CSV bulk import instead." });
});

// GET  /api/accounts/:accountId/locations  (paginated list)
router.get("/api/accounts/:accountId/locations", requireAuth, async (req: Request, res: Response) => {
  const { type, orderBy, search, cityTier, limit, offset } = req.query as Record<string, string>;
  const locationList = await storage.getLocations(
    req.params.accountId,
    type || undefined,
    orderBy || undefined,
    limit ? parseInt(limit) : undefined,
    offset ? parseInt(offset) : undefined,
    search || undefined,
    cityTier ? parseInt(cityTier) : undefined,
  );
  return res.json(locationList);
});

// POST /api/accounts/:accountId/locations  (single create)
router.post("/api/accounts/:accountId/locations", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertLocationSchema.safeParse({ ...req.body, accountId: req.params.accountId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const location = await storage.createLocation(parsed.data);
  return res.status(201).json(location);
});

// ── Services ──────────────────────────────────────────────────────────────────
// ✅ CHANGED: storage.getServices() takes accountId (not websiteId).
//   Resolve websiteId → accountId first so the DB query hits account_id correctly.
router.get("/api/websites/:websiteId/services", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.getWebsite(req.params.websiteId);
  if (!website) return res.status(404).json({ message: "Website not found" });
  const accountId = website.accountId;
  if (!accountId) return res.json([]);
  const services = await storage.getServices(accountId);
  return res.json(services);
});

// ✅ CHANGED: POST also needs accountId resolved from websiteId for the insert.
router.post("/api/websites/:websiteId/services", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.getWebsite(req.params.websiteId);
  if (!website) return res.status(404).json({ message: "Website not found" });
  const accountId = website.accountId;
  if (!accountId) return res.status(400).json({ message: "Website has no associated account" });
  const parsed = insertServiceSchema.safeParse({ ...req.body, accountId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const service = await storage.createService(parsed.data);
  return res.status(201).json(service);
});

router.put("/api/services/:id", requireAuth, async (req: Request, res: Response) => {
  // 🔒 UNTOUCHED
  const service = await storage.updateService(req.params.id, req.body);
  if (!service) return res.status(404).json({ message: "Service not found" });
  return res.json(service);
});

router.delete("/api/services/:id", requireAuth, async (req: Request, res: Response) => {
  // 🔒 UNTOUCHED
  await storage.deleteService(req.params.id);
  return res.json({ message: "Service deleted" });
});

// ✅ ADDED: Account-scoped services routes used by the ServicesPage tab.
//   The frontend calls GET/POST /api/accounts/:accountId/services directly.
router.get("/api/accounts/:accountId/services", requireAuth, async (req: Request, res: Response) => {
  const services = await storage.getServices(req.params.accountId);
  return res.json(services);
});

router.post("/api/accounts/:accountId/services", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertServiceSchema.safeParse({ ...req.body, accountId: req.params.accountId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const service = await storage.createService(parsed.data);
  return res.status(201).json(service);
});

// ── Brand Profiles ────────────────────────────────────────────────────────────
router.get("/api/websites/:websiteId/brand-profile", requireAuth, async (req: Request, res: Response) => {
  const brand = await storage.getBrandProfile(req.params.websiteId);
  return res.json(brand || null);
});

router.post("/api/websites/:websiteId/brand-profile", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertBrandProfileSchema.safeParse({ ...req.body, websiteId: req.params.websiteId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const brand = await storage.createBrandProfile(parsed.data);
  return res.status(201).json(brand);
});

router.put("/api/websites/:websiteId/brand-profile", requireAuth, async (req: Request, res: Response) => {
  const existing = await storage.getBrandProfile(req.params.websiteId);
  if (!existing) {
    const parsed = insertBrandProfileSchema.safeParse({ ...req.body, websiteId: req.params.websiteId });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const brand = await storage.createBrandProfile(parsed.data);
    return res.status(201).json(brand);
  }
  const brand = await storage.updateBrandProfile(existing.id, req.body);
  return res.json(brand);
});

// ✅ ADDED: Account-scoped brand-profiles routes used by BrandProfilesPage.
//   NOTE: ai-suggest must be registered BEFORE /:id so Express doesn't treat
//   "ai-suggest" as an :id param.
router.post("/api/accounts/:accountId/brand-profiles/ai-suggest", requireAuth, async (req: Request, res: Response) => {
  const { name, websiteUrl, industryName } = req.body as { name?: string; websiteUrl?: string; industryName?: string };
  if (!name?.trim()) {
    return res.status(400).json({ message: "name is required" });
  }
  try {
    const prompt = `You are a brand copywriter. For a business named "${name.trim()}"${industryName ? ` in the ${industryName} industry` : ""}${websiteUrl ? ` (website: ${websiteUrl})` : ""}, provide:\n1. A short punchy tagline (under 10 words).\n2. A 2-3 sentence brand description suitable for a business directory.\n3. A voice and tone guide (1-2 sentences describing communication style).\n\nRespond with ONLY valid JSON in this exact shape:\n{"tagline":"...","description":"...","voiceAndTone":"..."}`;
    const aiResponse = await callAI({ prompt, maxTokens: 512, temperature: 0.6 });
    const raw = aiResponse.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const parsed = JSON.parse(raw) as { tagline: string; description: string; voiceAndTone: string };
    return res.json({
      tagline: parsed.tagline ?? "",
      description: parsed.description ?? "",
      voiceAndTone: parsed.voiceAndTone ?? "",
    });
  } catch (err: any) {
    console.error("[brand-profiles/ai-suggest]", err);
    return res.status(500).json({ message: err.message ?? "AI suggestion failed" });
  }
});

router.get("/api/accounts/:accountId/brand-profiles", requireAuth, async (req: Request, res: Response) => {
  // Collects brand profiles across all websites belonging to the account.
  const websiteList = await storage.getWebsites(req.params.accountId);
  const profiles = await Promise.all(
    websiteList.map((w: any) => storage.getBrandProfile(w.id).catch(() => null))
  );
  return res.json(profiles.filter(Boolean));
});

router.post("/api/accounts/:accountId/brand-profiles", requireAuth, async (req: Request, res: Response) => {
  // Creates a brand profile. Attaches to the first website of this account if no websiteId is provided.
  const websiteList = await storage.getWebsites(req.params.accountId);
  const websiteId = req.body.websiteId || websiteList[0]?.id;
  if (!websiteId) {
    return res.status(400).json({ message: "No website found for this account. Create a website first." });
  }
  const parsed = insertBrandProfileSchema.safeParse({ ...req.body, websiteId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const brand = await storage.createBrandProfile(parsed.data);
  return res.status(201).json(brand);
});

router.delete("/api/brand-profiles/:id", requireAuth, async (req: Request, res: Response) => {
  await storage.deleteBrandProfile(req.params.id);
  return res.json({ message: "Brand profile deleted" });
});

// ── Industries ────────────────────────────────────────────────────────────────
router.get("/api/industries", requireAuth, async (_req: Request, res: Response) => {
  const industries = await storage.getIndustries();
  return res.json(industries);
});

router.post("/api/industries", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = insertIndustrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const industry = await storage.createIndustry(parsed.data);
  return res.status(201).json(industry);
});

router.put("/api/industries/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const industry = await storage.updateIndustry(req.params.id, req.body);
  if (!industry) return res.status(404).json({ message: "Industry not found" });
  return res.json(industry);
});

router.delete("/api/industries/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  await storage.deleteIndustry(req.params.id);
  return res.json({ message: "Industry deleted" });
});

router.get("/api/accounts/:accountId/industries", requireAuth, async (req: Request, res: Response) => {
  try {
    const industries = await storage.getIndustriesByAccount(req.params.accountId);
    return res.json(industries);
  } catch (err: any) {
    const industries = await storage.getIndustries();
    return res.json(industries);
  }
});

router.post("/api/accounts/:accountId/industries", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertIndustrySchema.safeParse({ ...req.body, accountId: req.params.accountId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const industry = await storage.createIndustry(parsed.data);
  return res.status(201).json(industry);
});

router.post("/api/accounts/:accountId/industries/ai-suggest", requireAuth, async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    return res.status(400).json({ message: "name is required" });
  }
  try {
    const prompt = `You are a business content expert. For the industry "${name.trim()}", provide:\n1. A concise 2-3 sentence description suitable for a business directory (plain text, no markdown).\n2. A JSON array of 5-8 related service names commonly offered in this industry.\n\nRespond with ONLY valid JSON in this exact shape:\n{"description":"...","relatedServices":["Service 1","Service 2"]}`;
    const aiResponse = await callAI({ prompt, maxTokens: 512, temperature: 0.5 });
    const raw = aiResponse.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const parsed = JSON.parse(raw) as { description: string; relatedServices: string[] };
    return res.json({
      description: parsed.description ?? "",
      relatedServices: Array.isArray(parsed.relatedServices) ? parsed.relatedServices : [],
    });
  } catch (err: any) {
    console.error("[industries/ai-suggest]", err);
    return res.status(500).json({ message: err.message ?? "AI suggestion failed" });
  }
});

// ── Blueprints ────────────────────────────────────────────────────────────────
router.get("/api/blueprints", requireAuth, async (_req: Request, res: Response) => {
  const blueprints = await storage.getBlueprints();
  return res.json(blueprints);
});

router.get("/api/blueprints/:id", requireAuth, async (req: Request, res: Response) => {
  const blueprint = await storage.getBlueprint(req.params.id);
  if (!blueprint) return res.status(404).json({ message: "Blueprint not found" });
  return res.json(blueprint);
});

// ✅ CHANGED: Added missing nested route for the Blueprints tab in Account detail page.
//   The frontend calls GET /api/websites/:websiteId/blueprints but this route never existed.
//   storage.getBlueprints() takes accountId — resolve websiteId → accountId first.
router.get("/api/websites/:websiteId/blueprints", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.getWebsite(req.params.websiteId);
  if (!website) return res.status(404).json({ message: "Website not found" });
  const accountId = website.accountId;
  if (!accountId) return res.json([]);
  const blueprints = await storage.getBlueprints(accountId);
  return res.json(blueprints);
});

router.post("/api/blueprints", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertBlueprintSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const blueprint = await storage.createBlueprint(parsed.data);
  return res.status(201).json(blueprint);
});

router.put("/api/blueprints/:id", requireAuth, async (req: Request, res: Response) => {
  const blueprint = await storage.updateBlueprint(req.params.id, req.body);
  if (!blueprint) return res.status(404).json({ message: "Blueprint not found" });
  return res.json(blueprint);
});

router.delete("/api/blueprints/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  await storage.deleteBlueprint(req.params.id);
  return res.json({ message: "Blueprint deleted" });
});

// ✅ ADDED: Account-scoped blueprint routes used by the Blueprints tab.
//   NOTE: bulk-generate routes must be registered BEFORE /api/accounts/:accountId/blueprints/:id
//   so Express doesn't treat "bulk-generate" as an :id param.
router.post("/api/accounts/:accountId/blueprints/bulk-generate", requireAuth, async (req: Request, res: Response) => {
  // Stub: returns a completed job immediately until a real bulk queue is wired in.
  const jobId = `bulk-bp-${Date.now()}-${randomBytes(4).toString("hex")}`;
  return res.json({ jobId, total: 0, done: 0, status: "completed", created: 0 });
});

router.get("/api/accounts/:accountId/blueprints/bulk-job/:jobId", requireAuth, async (req: Request, res: Response) => {
  return res.json({ jobId: req.params.jobId, total: 0, done: 0, status: "completed", created: 0 });
});

router.get("/api/accounts/:accountId/blueprints", requireAuth, async (req: Request, res: Response) => {
  const blueprints = await storage.getBlueprints(req.params.accountId);
  return res.json(blueprints);
});

router.post("/api/accounts/:accountId/blueprints", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertBlueprintSchema.safeParse({ ...req.body, accountId: req.params.accountId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const blueprint = await storage.createBlueprint(parsed.data);
  return res.status(201).json(blueprint);
});

router.delete("/api/accounts/:accountId/blueprints", requireAuth, async (req: Request, res: Response) => {
  // Deletes ALL blueprints for this account (used by "Delete All" button on BlueprintsPage)
  const blueprints = await storage.getBlueprints(req.params.accountId);
  for (const bp of blueprints) {
    await storage.deleteBlueprint(bp.id).catch(() => {});
  }
  return res.json({ count: blueprints.length });
});

// ── Query Clusters ────────────────────────────────────────────────────────────
// ✅ CHANGED: storage.getQueryClusters() takes accountId (not websiteId).
//   Resolve websiteId → accountId first so the DB query hits account_id correctly.
router.get("/api/websites/:websiteId/query-clusters", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.getWebsite(req.params.websiteId);
  if (!website) return res.status(404).json({ message: "Website not found" });
  const accountId = website.accountId;
  if (!accountId) return res.json([]);
  const clusters = await storage.getQueryClusters(accountId);
  return res.json(clusters);
});

// ✅ CHANGED: POST also needs accountId resolved from websiteId for the insert.
router.post("/api/websites/:websiteId/query-clusters", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.getWebsite(req.params.websiteId);
  if (!website) return res.status(404).json({ message: "Website not found" });
  const accountId = website.accountId;
  if (!accountId) return res.status(400).json({ message: "Website has no associated account" });
  const parsed = insertQueryClusterSchema.safeParse({ ...req.body, accountId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const cluster = await storage.createQueryCluster(parsed.data);
  return res.status(201).json(cluster);
});

router.delete("/api/query-clusters/:id", requireAuth, async (req: Request, res: Response) => {
  // 🔒 UNTOUCHED
  await storage.deleteQueryCluster(req.params.id);
  return res.json({ message: "Query cluster deleted" });
});

// ✅ ADDED: Account-scoped query-clusters routes used by QueryClustersPage.
//   NOTE: specific action routes (ai-generate, bulk-suggest, bulk-save) must be
//   registered BEFORE the plain GET /api/accounts/:accountId/query-clusters route
//   so Express doesn't treat action path segments as :id params.
router.post("/api/accounts/:accountId/query-clusters/ai-generate", requireAuth, async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    // Gather services and brand context for this account
    const serviceList = await storage.getServices(accountId);
    const websiteList = await storage.getWebsites(accountId);
    const brand = websiteList[0] ? await storage.getBrandProfile(websiteList[0].id).catch(() => null) : null;
    const industryId = brand?.industryId;
    const industry = industryId ? await storage.getIndustry(industryId).catch(() => null) : null;
    const brandName = brand?.name || "the business";
    const industryName = industry?.name || "general services";
    const serviceNames = serviceList.slice(0, 10).map((s: any) => s.name).join(", ") || "general services";

    const prompt = `You are an SEO strategist. For a business named "${brandName}" in the "${industryName}" industry offering: ${serviceNames}.\n\nGenerate 10 high-value query clusters. Each cluster should target a specific search intent.\n\nRespond with ONLY valid JSON array:\n[{"name":"...","primaryKeyword":"...","intentType":"transactional|local|informational|navigational","searchVolume":1000,"difficulty":45,"secondaryKeywords":["kw1","kw2"]}]`;

    const aiResponse = await callAI({ prompt, maxTokens: 1500, temperature: 0.6 });
    const raw = aiResponse.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const suggestions = JSON.parse(raw) as any[];

    const inserted: any[] = [];
    for (const s of suggestions) {
      try {
        const parsed = insertQueryClusterSchema.safeParse({ ...s, accountId });
        if (!parsed.success) continue;
        const cluster = await storage.createQueryCluster(parsed.data);
        inserted.push(cluster);
      } catch {}
    }
    return res.json({ inserted: inserted.length, clusters: inserted });
  } catch (err: any) {
    console.error("[query-clusters/ai-generate]", err);
    return res.status(500).json({ message: err.message ?? "AI generation failed" });
  }
});

router.post("/api/accounts/:accountId/query-clusters/bulk-suggest", requireAuth, async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    const { services: serviceNames } = req.body as { services?: string[] };
    if (!Array.isArray(serviceNames) || serviceNames.length === 0) {
      return res.status(400).json({ message: "services array is required" });
    }
    const websiteList = await storage.getWebsites(accountId);
    const brand = websiteList[0] ? await storage.getBrandProfile(websiteList[0].id).catch(() => null) : null;
    const brandName = brand?.name || "the business";

    const suggestions: Array<{ service: string; clusters: any[] }> = [];

    for (const serviceName of serviceNames.slice(0, 8)) {
      try {
        const prompt = `You are an SEO strategist. For a business named "${brandName}" offering "${serviceName}", generate 10-15 query clusters targeting different search intents (transactional, local, informational).\n\nRespond with ONLY valid JSON array:\n[{"name":"...","primaryKeyword":"...","intentType":"transactional|local|informational|navigational","searchVolume":1000,"difficulty":45,"secondaryKeywords":["kw1","kw2"]}]`;
        const aiResponse = await callAI({ prompt, maxTokens: 1200, temperature: 0.6 });
        const raw = aiResponse.text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
        const clusters = JSON.parse(raw) as any[];
        suggestions.push({ service: serviceName, clusters: Array.isArray(clusters) ? clusters : [] });
      } catch {
        suggestions.push({ service: serviceName, clusters: [] });
      }
    }

    return res.json({ suggestions });
  } catch (err: any) {
    console.error("[query-clusters/bulk-suggest]", err);
    return res.status(500).json({ message: err.message ?? "Bulk suggest failed" });
  }
});

router.post("/api/accounts/:accountId/query-clusters/bulk-save", requireAuth, async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    const { clusters } = req.body as { clusters?: any[] };
    if (!Array.isArray(clusters) || clusters.length === 0) {
      return res.status(400).json({ message: "clusters array is required" });
    }
    let saved = 0;
    for (const c of clusters) {
      try {
        const parsed = insertQueryClusterSchema.safeParse({ ...c, accountId });
        if (!parsed.success) continue;
        await storage.createQueryCluster(parsed.data);
        saved++;
      } catch {}
    }
    return res.json({ saved });
  } catch (err: any) {
    console.error("[query-clusters/bulk-save]", err);
    return res.status(500).json({ message: err.message ?? "Bulk save failed" });
  }
});

router.get("/api/accounts/:accountId/query-clusters", requireAuth, async (req: Request, res: Response) => {
  const clusters = await storage.getQueryClusters(req.params.accountId);
  return res.json(clusters);
});

router.post("/api/accounts/:accountId/query-clusters", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertQueryClusterSchema.safeParse({ ...req.body, accountId: req.params.accountId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const cluster = await storage.createQueryCluster(parsed.data);
  return res.status(201).json(cluster);
});

// ── Pages ─────────────────────────────────────────────────────────────────────
router.get("/api/websites/:websiteId/pages", requireAuth, async (req: Request, res: Response) => {
  const { status, limit, offset, search } = req.query as Record<string, string>;
  const pageList = await storage.getPages(req.params.websiteId, {
    status: status as any,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined,
    search,
  });
  return res.json(pageList);
});

router.get("/api/pages/:id", requireAuth, async (req: Request, res: Response) => {
  const page = await storage.getPage(req.params.id);
  if (!page) return res.status(404).json({ message: "Page not found" });
  return res.json(page);
});

router.post("/api/pages", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertPageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const page = await storage.createPage(parsed.data);
  return res.status(201).json(page);
});

router.put("/api/pages/:id", requireAuth, async (req: Request, res: Response) => {
  const page = await storage.updatePage(req.params.id, req.body);
  if (!page) return res.status(404).json({ message: "Page not found" });
  invalidatePageCache(page.websiteId, page.slug);
  return res.json(page);
});

router.post("/api/pages/:id/publish", requireAuth, async (req: Request, res: Response) => {
  const page = await storage.publishPage(req.params.id);
  if (!page) return res.status(404).json({ message: "Page not found" });
  invalidatePageCache(page.websiteId, page.slug);
  return res.json(page);
});

router.post("/api/pages/:id/unpublish", requireAuth, async (req: Request, res: Response) => {
  const page = await storage.unpublishPage(req.params.id);
  if (!page) return res.status(404).json({ message: "Page not found" });
  invalidatePageCache(page.websiteId, page.slug);
  return res.json(page);
});

router.delete("/api/pages/:id", requireAuth, async (req: Request, res: Response) => {
  const page = await storage.getPage(req.params.id);
  if (page) invalidatePageCache(page.websiteId, page.slug);
  await storage.deletePage(req.params.id);
  return res.json({ message: "Page deleted" });
});

// ── Generation Jobs ───────────────────────────────────────────────────────────
router.get("/api/websites/:websiteId/generation-jobs", requireAuth, async (req: Request, res: Response) => {
  const jobs = await storage.getGenerationJobs(req.params.websiteId);
  return res.json(jobs);
});

router.get("/api/generation-jobs/:id", requireAuth, async (req: Request, res: Response) => {
  const job = await storage.getGenerationJob(req.params.id);
  if (!job) return res.status(404).json({ message: "Job not found" });
  return res.json(job);
});

router.get("/api/jobs/:jobId", requireAuth, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const fillJob = fillMissingJobs.get(jobId);
  if (fillJob) return res.json(fillJob);
  const thinJob = writeThinJobs.get(jobId);
  if (thinJob) return res.json(thinJob);
  const job = await storage.getGenerationJob(jobId).catch(() => null);
  if (job) return res.json(job);
  return res.status(404).json({ message: "Job not found" });
});

// ── Variation Banks ───────────────────────────────────────────────────────────
router.get("/api/websites/:websiteId/variation-banks", requireAuth, async (req: Request, res: Response) => {
  const { service } = req.query as { service?: string };
  if (service) {
    const banks = await storage.getVariationBanks(req.params.websiteId, service);
    return res.json(banks);
  }
  const services = await storage.getVariationBankServices(req.params.websiteId);
  return res.json(services);
});

router.get("/api/websites/:websiteId/variation-banks/completeness", requireAuth, async (req: Request, res: Response) => {
  const completeness = await storage.getBankCompleteness(req.params.websiteId);
  return res.json(completeness);
});

router.get("/api/websites/:websiteId/bank-completeness", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await storage.getBankCompleteness(req.params.websiteId);
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ message: err.message ?? "Failed to load bank completeness" });
  }
});

router.post("/api/websites/:websiteId/bank-completeness/recompute", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    const services = await storage.getVariationBankServices(websiteId);
    let computed = 0;
    for (const service of services) {
      await storage.recomputeBankCompleteness(websiteId, service).catch(() => {});
      computed++;
    }
    return res.json({ computed });
  } catch (err: any) {
    return res.status(500).json({ message: err.message ?? "Recompute failed" });
  }
});

router.post("/api/websites/:websiteId/variation-banks/write", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    const { service } = req.body as { service: string };
    if (!service?.trim()) return res.status(400).json({ message: "service is required" });
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ message: "Website not found" });
    const account = website.accountId ? await storage.getAccount(website.accountId).catch(() => null) : null;
    const brand = await storage.getBrandProfile(websiteId).catch(() => null);
    const industry = brand?.industryId ? await storage.getIndustry(brand.industryId).catch(() => null) : null;
    const ctx: BrandContext = {
      brandName: brand?.name || website.name || website.domain,
      brandDescription: brand?.description ?? undefined,
      voiceAndTone: brand?.voiceAndTone ?? undefined,
      industryName: industry?.name ?? undefined,
      industryDescription: industry?.description ?? undefined,
    };
    const result = await writeVariationsForService(service.trim(), website.accountId ?? websiteId, websiteId, ctx);
    await storage.recomputeBankCompleteness(websiteId, service.trim()).catch(() => {});
    return res.json({ written: result.written, errors: result.errors });
  } catch (err: any) {
    console.error("[variation-banks/write]", err);
    return res.status(500).json({ message: err.message ?? "Write failed" });
  }
});

router.post("/api/websites/:websiteId/variation-banks/fill-missing", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    const { service } = req.body as { service: string };
    if (!service?.trim()) return res.status(400).json({ message: "service is required" });
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ message: "Website not found" });
    const brand = await storage.getBrandProfile(websiteId).catch(() => null);
    const industry = brand?.industryId ? await storage.getIndustry(brand.industryId).catch(() => null) : null;
    const ctx: BrandContext = {
      brandName: brand?.name || website.name || website.domain,
      brandDescription: brand?.description ?? undefined,
      voiceAndTone: brand?.voiceAndTone ?? undefined,
      industryName: industry?.name ?? undefined,
      industryDescription: industry?.description ?? undefined,
    };
    const result = await fillMissingSectionsForService(service.trim(), website.accountId ?? websiteId, websiteId, ctx);
    if (result.filled.length > 0) {
      await storage.recomputeBankCompleteness(websiteId, service.trim()).catch(() => {});
    }
    return res.json({ filled: result.filled, skipped: result.skipped, errors: result.errors });
  } catch (err: any) {
    console.error("[variation-banks/fill-missing]", err);
    return res.status(500).json({ message: err.message ?? "Fill missing failed" });
  }
});

router.post("/api/websites/:websiteId/variation-banks/fill-missing-all-job", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    const { services } = req.body as { services?: string[] };
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ message: "Website not found" });
    const targetServices: string[] = Array.isArray(services) && services.length > 0
      ? services
      : await storage.getVariationBankServices(websiteId);
    if (targetServices.length === 0) {
      return res.json({ started: false, message: "No services found to fill" });
    }
    const jobId = `fill-all-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const job: FillMissingJob = {
      jobId, websiteId, status: "running",
      totalPages: targetServices.length, processedPages: 0, errors: [], startedAt: Date.now(),
    };
    fillMissingJobs.set(jobId, job);
    storage.updateWebsiteSettings(websiteId, { fillMissingJobId: jobId }).catch(() => {});
    setImmediate(async () => {
      const brand = await storage.getBrandProfile(websiteId).catch(() => null);
      const industry = brand?.industryId ? await storage.getIndustry(brand.industryId).catch(() => null) : null;
      const ctx: BrandContext = {
        brandName: brand?.name || website.name || website.domain,
        brandDescription: brand?.description ?? undefined,
        voiceAndTone: brand?.voiceAndTone ?? undefined,
        industryName: industry?.name ?? undefined,
        industryDescription: industry?.description ?? undefined,
      };
      for (const service of targetServices) {
        try {
          const result = await fillMissingSectionsForService(service, website.accountId ?? websiteId, websiteId, ctx);
          if (result.filled.length > 0) {
            await storage.recomputeBankCompleteness(websiteId, service).catch(() => {});
          }
          if (result.errors.length > 0) {
            job.errors.push(...result.errors.map(e => `${service}: ${e}`));
          }
        } catch (err: any) {
          job.errors.push(`${service}: ${err?.message ?? String(err)}`);
        }
        job.processedPages++;
      }
      job.status = job.errors.length > 0 && job.processedPages === 0 ? "failed" : "completed";
      storage.updateWebsiteSettings(websiteId, { fillMissingJobId: null }).catch(() => {});
    });
    return res.json({ started: true, jobId, total: targetServices.length });
  } catch (err: any) {
    console.error("[fill-missing-all-job]", err);
    return res.status(500).json({ message: err.message ?? "Failed to start fill job" });
  }
});

router.get("/api/websites/:websiteId/fill-missing-job", requireAuth, async (req: Request, res: Response) => {
  const { websiteId } = req.params;
  let latestJob: FillMissingJob | null = null;
  for (const job of fillMissingJobs.values()) {
    if (job.websiteId === websiteId && job.status === "running") {
      if (!latestJob || job.startedAt > latestJob.startedAt) latestJob = job;
    }
  }
  if (latestJob) return res.json({ jobId: latestJob.jobId });
  return res.json({ jobId: null });
});

router.post("/api/websites/:websiteId/variation-banks/write-thin", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    const threshold: number = typeof req.body.threshold === "number" ? req.body.threshold : 70;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ message: "Website not found" });
    const allRows = await storage.getBankCompleteness(websiteId);
    const thinServices: string[] = allRows
      .filter((r: any) => (r.completenessScore ?? 0) < threshold)
      .map((r: any) => r.service as string);
    if (thinServices.length === 0) {
      return res.json({ started: false, message: `No services below ${threshold}% completeness` });
    }
    const jobId = `write-thin-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const job: WriteThinJob = {
      jobId, websiteId, status: "running",
      total: thinServices.length, done: 0, errors: [], startedAt: Date.now(),
    };
    writeThinJobs.set(jobId, job);
    storage.updateWebsiteSettings(websiteId, { writeThinJobId: jobId }).catch(() => {});
    setImmediate(async () => {
      const brand = await storage.getBrandProfile(websiteId).catch(() => null);
      const industry = brand?.industryId ? await storage.getIndustry(brand.industryId).catch(() => null) : null;
      const ctx: BrandContext = {
        brandName: brand?.name || website.name || website.domain,
        brandDescription: brand?.description ?? undefined,
        voiceAndTone: brand?.voiceAndTone ?? undefined,
        industryName: industry?.name ?? undefined,
        industryDescription: industry?.description ?? undefined,
      };
      for (const service of thinServices) {
        try {
          await writeVariationsForService(service, website.accountId ?? websiteId, websiteId, ctx);
          await storage.recomputeBankCompleteness(websiteId, service).catch(() => {});
        } catch (err: any) {
          job.errors.push(`${service}: ${err?.message ?? String(err)}`);
        }
        job.done++;
      }
      job.status = "done";
      storage.updateWebsiteSettings(websiteId, { writeThinJobId: null }).catch(() => {});
    });
    return res.json({ started: true, jobId, total: thinServices.length });
  } catch (err: any) {
    console.error("[write-thin]", err);
    return res.status(500).json({ message: err.message ?? "Failed to start write-thin job" });
  }
});

router.get("/api/websites/:websiteId/bank-write-job", requireAuth, async (req: Request, res: Response) => {
  const { websiteId } = req.params;
  let latestJob: WriteThinJob | null = null;
  for (const job of writeThinJobs.values()) {
    if (job.websiteId === websiteId && job.status === "running") {
      if (!latestJob || job.startedAt > latestJob.startedAt) latestJob = job;
    }
  }
  if (latestJob) return res.json({ jobId: latestJob.jobId, status: latestJob.status, total: latestJob.total, done: latestJob.done });
  return res.json({ jobId: null });
});

// ── Sitemaps ──────────────────────────────────────────────────────────────────
router.post("/api/websites/:websiteId/generate-sitemaps", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.getWebsite(req.params.websiteId);
  if (!website) return res.status(404).json({ message: "Website not found" });
  try {
    await generateSitemapsForWebsite(req.params.websiteId);
    invalidateSitemapCache(req.params.websiteId);
    return res.json({ message: "Sitemaps generated" });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

// ── Public contact form ───────────────────────────────────────────────────────
router.post("/api/public/contact", async (req: Request, res: Response) => {
  const { websiteId, pageId, pageSlug, name, businessName, email, phone, message } = req.body;
  if (!websiteId || !name || !email) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }
  try {
    await storage.createTrackedLead({
      websiteId,
      pageId: pageId || null,
      pageSlug: pageSlug || null,
      name,
      businessName: businessName || null,
      email,
      phone: phone || null,
      message: message || null,
      source: "contact_form",
    });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[contact-form] Error saving lead:", err);
    return res.status(500).json({ success: false, message: "Failed to save submission" });
  }
});

export default router;
