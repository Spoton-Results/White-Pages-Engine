/**
 * core-api.ts
 *
 * All API routes that were living exclusively in the old routes.ts monolith
 * and were never wired into index.ts after the modular migration began.
 *
 * Covers:
 *   - /api/accounts
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
 *   - /api/variation-banks
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
import { invalidateSitemapCache, invalidatePageCache } from "../routes";

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

// ── Websites ──────────────────────────────────────────────────────────────────
router.get("/api/websites", requireAuth, async (req: Request, res: Response) => {
  const accountId = req.query.accountId as string | undefined;
  if (accountId) {
    const websiteList = await storage.getWebsites(accountId);
    return res.json(websiteList);
  }
  const all = await storage.getAllWebsites();
  return res.json(all);
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
