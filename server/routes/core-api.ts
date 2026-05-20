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

// ── Health (safety net) ───────────────────────────────────────────────────────
router.get("/health", (_req, res) => res.status(200).json({ ok: true }));
router.get("/_health", (_req, res) => res.status(200).json({ ok: true }));

// ── Accounts ──────────────────────────────────────────────────────────────────
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
// The frontend "Create Agency" form POSTs to /api/agencies. Without these
// routes the server returns an HTML 404 page, causing the
// "Unexpected token '<', <!DOCTYPE..." JSON parse error in the browser.
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
  // Map agency-specific field names to account schema if needed
  const body = { ...req.body };
  // The Create Agency form sends "name" — insertAccountSchema expects "name" too, so no transform needed.
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
  // getWebsites(accountId?) handles both filtered and unfiltered cases:
  // - with accountId → returns websites for that account only
  // - without accountId → returns all websites across all accounts
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

// Website settings
router.put("/api/websites/:id/settings", requireAuth, async (req: Request, res: Response) => {
  const website = await storage.updateWebsiteSettings(req.params.id, req.body);
  if (!website) return res.status(404).json({ message: "Website not found" });
  return res.json(website);
});

// ── Locations ─────────────────────────────────────────────────────────────────
router.get("/api/websites/:websiteId/locations", requireAuth, async (req: Request, res: Response) => {
  const locations = await storage.getLocations(req.params.websiteId);
  return res.json(locations);
});

router.post("/api/websites/:websiteId/locations", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertLocationSchema.safeParse({ ...req.body, websiteId: req.params.websiteId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const location = await storage.createLocation(parsed.data);
  return res.status(201).json(location);
});

router.put("/api/locations/:id", requireAuth, async (req: Request, res: Response) => {
  const location = await storage.updateLocation(req.params.id, req.body);
  if (!location) return res.status(404).json({ message: "Location not found" });
  return res.json(location);
});

router.delete("/api/locations/:id", requireAuth, async (req: Request, res: Response) => {
  await storage.deleteLocation(req.params.id);
  return res.json({ message: "Location deleted" });
});

// ── Services ──────────────────────────────────────────────────────────────────
router.get("/api/websites/:websiteId/services", requireAuth, async (req: Request, res: Response) => {
  const services = await storage.getServices(req.params.websiteId);
  return res.json(services);
});

router.post("/api/websites/:websiteId/services", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertServiceSchema.safeParse({ ...req.body, websiteId: req.params.websiteId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const service = await storage.createService(parsed.data);
  return res.status(201).json(service);
});

router.put("/api/services/:id", requireAuth, async (req: Request, res: Response) => {
  const service = await storage.updateService(req.params.id, req.body);
  if (!service) return res.status(404).json({ message: "Service not found" });
  return res.json(service);
});

router.delete("/api/services/:id", requireAuth, async (req: Request, res: Response) => {
  await storage.deleteService(req.params.id);
  return res.json({ message: "Service deleted" });
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

// ── Query Clusters ────────────────────────────────────────────────────────────
router.get("/api/websites/:websiteId/query-clusters", requireAuth, async (req: Request, res: Response) => {
  const clusters = await storage.getQueryClusters(req.params.websiteId);
  return res.json(clusters);
});

router.post("/api/websites/:websiteId/query-clusters", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertQueryClusterSchema.safeParse({ ...req.body, websiteId: req.params.websiteId });
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const cluster = await storage.createQueryCluster(parsed.data);
  return res.status(201).json(cluster);
});

router.delete("/api/query-clusters/:id", requireAuth, async (req: Request, res: Response) => {
  await storage.deleteQueryCluster(req.params.id);
  return res.json({ message: "Query cluster deleted" });
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

// Generic job polling endpoint used by the Bank Health fill-missing-all job
router.get("/api/jobs/:jobId", requireAuth, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  // Check fill-missing jobs first
  const fillJob = fillMissingJobs.get(jobId);
  if (fillJob) return res.json(fillJob);
  // Check write-thin jobs
  const thinJob = writeThinJobs.get(jobId);
  if (thinJob) return res.json(thinJob);
  // Fall back to generation jobs table
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

// ── Bank Completeness (Bank Health page) ──────────────────────────────────────

// GET  /api/websites/:websiteId/bank-completeness
// Returns cached completeness rows for the Bank Health dashboard
router.get("/api/websites/:websiteId/bank-completeness", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await storage.getBankCompleteness(req.params.websiteId);
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ message: err.message ?? "Failed to load bank completeness" });
  }
});

// POST /api/websites/:websiteId/bank-completeness/recompute
// Recomputes completeness scores for every service in the website's bank
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

// ── Variation Bank Write (single service, full 14-section rewrite) ────────────

// POST /api/websites/:websiteId/variation-banks/write
// Rewrites ALL 14 sections (Core + Extended + SEO Expansion) for a single service.
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

// ── Fill Missing (single service) ─────────────────────────────────────────────

// POST /api/websites/:websiteId/variation-banks/fill-missing
// Fills ONLY the sections that don't yet exist for the given service.
// Includes SEO Expansion sections: comparison, pricing_factors, best_fit, software_integration.
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

    // Recompute completeness score after filling
    if (result.filled.length > 0) {
      await storage.recomputeBankCompleteness(websiteId, service.trim()).catch(() => {});
    }

    return res.json({ filled: result.filled, skipped: result.skipped, errors: result.errors });
  } catch (err: any) {
    console.error("[variation-banks/fill-missing]", err);
    return res.status(500).json({ message: err.message ?? "Fill missing failed" });
  }
});

// ── Fill Missing All (background job — all services for a website) ─────────────

// POST /api/websites/:websiteId/variation-banks/fill-missing-all-job
// Starts a background job that fills missing sections for multiple services.
// Returns { started: true, jobId, total } immediately.
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
      jobId,
      websiteId,
      status: "running",
      totalPages: targetServices.length,
      processedPages: 0,
      errors: [],
      startedAt: Date.now(),
    };
    fillMissingJobs.set(jobId, job);

    // Store jobId on website for restore-on-reload
    storage.updateWebsiteSettings(websiteId, { fillMissingJobId: jobId }).catch(() => {});

    // Run in background
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
      // Clean up stored jobId
      storage.updateWebsiteSettings(websiteId, { fillMissingJobId: null }).catch(() => {});
    });

    return res.json({ started: true, jobId, total: targetServices.length });
  } catch (err: any) {
    console.error("[fill-missing-all-job]", err);
    return res.status(500).json({ message: err.message ?? "Failed to start fill job" });
  }
});

// GET /api/websites/:websiteId/fill-missing-job
// Returns the active fill-missing-all job for this website (for restore-on-reload)
router.get("/api/websites/:websiteId/fill-missing-job", requireAuth, async (req: Request, res: Response) => {
  const { websiteId } = req.params;
  // Find the most recent running job for this website
  let latestJob: FillMissingJob | null = null;
  for (const job of fillMissingJobs.values()) {
    if (job.websiteId === websiteId && job.status === "running") {
      if (!latestJob || job.startedAt > latestJob.startedAt) latestJob = job;
    }
  }
  if (latestJob) return res.json({ jobId: latestJob.jobId });
  return res.json({ jobId: null });
});

// ── Write Thin Banks (bulk background job) ────────────────────────────────────

// POST /api/websites/:websiteId/variation-banks/write-thin
// Starts a background job that rewrites all services whose completeness
// score is below the given threshold (default 70). Rewrites ALL 14 sections.
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
      jobId,
      websiteId,
      status: "running",
      total: thinServices.length,
      done: 0,
      errors: [],
      startedAt: Date.now(),
    };
    writeThinJobs.set(jobId, job);

    // Store jobId on website for restore-on-reload
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

// GET /api/websites/:websiteId/bank-write-job
// Returns the active write-thin job status for this website (for restore-on-reload)
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
