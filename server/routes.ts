import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { sessionMiddleware, requireAuth, requireSuperAdmin, loginUser, hashPassword } from "./auth";
import * as storage from "./storage";
import { runGenerationJob } from "./services/generation";
import { generateBlueprint, suggestServices } from "./services/claude";
import { generateSitemapsForWebsite, generateRobotsTxt } from "./services/sitemap";
import { isR2Configured } from "./services/r2";
import {
  insertAccountSchema, insertUserSchema, insertBrandProfileSchema,
  insertWebsiteSchema, insertLocationSchema, insertServiceSchema,
  insertIndustrySchema, insertQueryClusterSchema, insertBlueprintSchema,
  insertPageSchema, insertGenerationJobSchema,
} from "@shared/schema";
import { z } from "zod";

function notFoundHtml(msg: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title>
  <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f9fa;}
  .box{text-align:center;padding:2rem;max-width:400px;}h1{color:#374151;}p{color:#6b7280;}</style></head>
  <body><div class="box"><h1>404</h1><p>${msg}</p></div></body></html>`;
}

function renderPageHtml(page: any, version: any, website: any, brand: any): string {
  const brandName = brand?.name || website.domain;
  const primaryColor = brand?.primaryColor || "#2563eb";
  const phone = brand?.phone || "";
  const tagline = brand?.tagline || "";

  // Schema markup
  const schemaJson = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": page.title,
    "description": page.metaDescription,
    "url": `https://${website.domain}/${page.slug}`,
    "publisher": { "@type": "Organization", "name": brandName },
  });

  const faqSchema = page.faqItems?.length ? JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": page.faqItems.map((f: any) => ({
      "@type": "Question",
      "name": f.question,
      "acceptedAnswer": { "@type": "Answer", "text": f.answer },
    })),
  }) : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${page.title}</title>
  <meta name="description" content="${(page.metaDescription || "").replace(/"/g, "&quot;")}" />
  <meta property="og:title" content="${page.title}" />
  <meta property="og:description" content="${(page.metaDescription || "").replace(/"/g, "&quot;")}" />
  <meta property="og:type" content="website" />
  <link rel="canonical" href="https://${website.domain}/${page.slug}" />
  <script type="application/ld+json">${schemaJson}</script>
  ${faqSchema ? `<script type="application/ld+json">${faqSchema}</script>` : ""}
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2937;line-height:1.6}
    a{color:${primaryColor};text-decoration:none}
    a:hover{text-decoration:underline}
    header{background:${primaryColor};color:#fff;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem}
    header .brand{font-size:1.25rem;font-weight:700;color:#fff}
    header .phone{font-size:1rem;font-weight:600;color:#fff;opacity:.9}
    .hero{background:${primaryColor}10;border-bottom:1px solid ${primaryColor}20;padding:3rem 2rem 2.5rem}
    .hero h1{font-size:2rem;font-weight:800;color:#111827;max-width:800px;line-height:1.2}
    .hero .tagline{color:#6b7280;margin-top:.5rem;font-size:1rem}
    main{max-width:900px;margin:2.5rem auto;padding:0 1.5rem}
    main h2{font-size:1.35rem;font-weight:700;color:#111827;margin:2rem 0 .75rem;padding-bottom:.5rem;border-bottom:2px solid ${primaryColor}20}
    main p{margin-bottom:1rem;color:#374151}
    main ul,main ol{margin:.5rem 0 1rem 1.5rem}
    main li{margin-bottom:.35rem;color:#374151}
    main strong{color:#111827}
    .cta-box{background:${primaryColor};color:#fff;border-radius:.75rem;padding:2rem;margin:2.5rem 0;text-align:center}
    .cta-box h2{color:#fff;border:none;margin:.5rem 0}
    .cta-box p{color:#fff;opacity:.9}
    .cta-box a{display:inline-block;background:#fff;color:${primaryColor};font-weight:700;padding:.75rem 2rem;border-radius:.5rem;margin-top:1rem;font-size:1rem}
    .cta-box a:hover{background:#f0f0f0;text-decoration:none}
    footer{background:#f9fafb;border-top:1px solid #e5e7eb;padding:1.5rem 2rem;text-align:center;color:#9ca3af;font-size:.85rem;margin-top:3rem}
  </style>
</head>
<body>
  <header>
    <span class="brand">${brandName}</span>
    ${phone ? `<a href="tel:${phone.replace(/\D/g, "")}" class="phone">${phone}</a>` : ""}
  </header>

  <div class="hero">
    <h1>${page.h1 || page.title}</h1>
    ${tagline ? `<p class="tagline">${tagline}</p>` : ""}
  </div>

  <main>
    ${version?.contentHtml || "<p>Content coming soon.</p>"}
  </main>

  <footer>
    &copy; ${new Date().getFullYear()} ${brandName}. All rights reserved.
    ${phone ? ` &bull; <a href="tel:${phone.replace(/\D/g, "")}">${phone}</a>` : ""}
  </footer>
</body>
</html>`;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use(sessionMiddleware());

  // ── Auth Routes ──────────────────────────────────────────────────────────

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }
    const user = await loginUser(req, email, password);
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const { password: _, ...safeUser } = user;
    return res.json({ user: safeUser });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    const { password: _, ...safeUser } = user;
    return res.json({ user: safeUser });
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────

  app.get("/api/dashboard/stats", requireAuth, async (req: Request, res: Response) => {
    const stats = await storage.getDashboardStats();
    return res.json(stats);
  });

  app.get("/api/dashboard/activity", requireAuth, async (req: Request, res: Response) => {
    const activity = await storage.getRecentActivity(20);
    return res.json(activity);
  });

  // ── Accounts ──────────────────────────────────────────────────────────────

  app.get("/api/accounts", requireAuth, async (req: Request, res: Response) => {
    const all = await storage.getAccounts();
    return res.json(all);
  });

  app.get("/api/accounts/:id", requireAuth, async (req: Request, res: Response) => {
    const account = await storage.getAccount((req.params.id as string));
    if (!account) return res.status(404).json({ message: "Account not found" });
    return res.json(account);
  });

  app.post("/api/accounts", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const parsed = insertAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const account = await storage.createAccount(parsed.data);
    return res.status(201).json(account);
  });

  app.patch("/api/accounts/:id", requireAuth, async (req: Request, res: Response) => {
    const account = await storage.updateAccount((req.params.id as string), req.body);
    if (!account) return res.status(404).json({ message: "Account not found" });
    return res.json(account);
  });

  app.delete("/api/accounts/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    await storage.deleteAccount((req.params.id as string));
    return res.json({ message: "Account deleted" });
  });

  // ── Users ─────────────────────────────────────────────────────────────────

  app.get("/api/accounts/:accountId/users", requireAuth, async (req: Request, res: Response) => {
    const users = await storage.getUsersByAccount((req.params.accountId as string));
    return res.json(users.map(({ password: _, ...u }) => u));
  });

  app.post("/api/accounts/:accountId/users", requireAuth, async (req: Request, res: Response) => {
    const { password, ...rest } = req.body;
    const hashed = await hashPassword(password || "changeme");
    const user = await storage.createUser({
      ...rest,
      accountId: (req.params.accountId as string),
      password: hashed,
    });
    const { password: _, ...safeUser } = user;
    return res.status(201).json(safeUser);
  });

  app.get("/api/users", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const accounts = await storage.getAccounts();
    const accountMap = new Map(accounts.map((a: any) => [a.id, a.name]));
    const allUsers: any[] = [];
    const seenIds = new Set<string>();
    for (const acc of accounts) {
      const users = await storage.getUsersByAccount(acc.id);
      for (const { password: _, ...u } of users) {
        if (!seenIds.has(u.id)) {
          seenIds.add(u.id);
          allUsers.push({ ...u, accountName: acc.name });
        }
      }
    }
    // Also include super-admin users with no account (platform-level admins)
    const superAdmins = await storage.getSuperAdminUsers();
    for (const { password: _, ...u } of superAdmins) {
      if (!seenIds.has(u.id)) {
        seenIds.add(u.id);
        const accountName = u.accountId ? (accountMap.get(u.accountId) || "Unknown") : "Platform";
        allUsers.push({ ...u, accountName });
      }
    }
    return res.json(allUsers);
  });

  // Platform-level user creation (super admin only)
  app.post("/api/users", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const { password, ...rest } = req.body;
    const hashed = await hashPassword(password || "changeme");
    const user = await storage.createUser({ ...rest, password: hashed });
    const { password: _, ...safeUser } = user;
    return res.status(201).json(safeUser);
  });

  // ── Brand Profiles ────────────────────────────────────────────────────────

  app.get("/api/accounts/:accountId/brand-profiles", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getBrandProfiles((req.params.accountId as string)));
  });

  app.post("/api/accounts/:accountId/brand-profiles", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertBrandProfileSchema.safeParse({ ...req.body, accountId: (req.params.accountId as string) });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    return res.status(201).json(await storage.createBrandProfile(parsed.data));
  });

  app.get("/api/brand-profiles/:id", requireAuth, async (req: Request, res: Response) => {
    const bp = await storage.getBrandProfile((req.params.id as string));
    if (!bp) return res.status(404).json({ message: "Brand profile not found" });
    return res.json(bp);
  });

  app.patch("/api/brand-profiles/:id", requireAuth, async (req: Request, res: Response) => {
    const bp = await storage.updateBrandProfile((req.params.id as string), req.body);
    if (!bp) return res.status(404).json({ message: "Not found" });
    return res.json(bp);
  });

  app.delete("/api/brand-profiles/:id", requireAuth, async (req: Request, res: Response) => {
    await storage.deleteBrandProfile((req.params.id as string));
    return res.json({ message: "Deleted" });
  });

  // ── Websites ──────────────────────────────────────────────────────────────

  app.get("/api/websites", requireAuth, async (req: Request, res: Response) => {
    const accountId = req.query.accountId as string | undefined;
    return res.json(await storage.getWebsites(accountId));
  });

  app.get("/api/websites/:id", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.getWebsite((req.params.id as string));
    if (!website) return res.status(404).json({ message: "Website not found" });
    return res.json(website);
  });

  app.post("/api/websites", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertWebsiteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    return res.status(201).json(await storage.createWebsite(parsed.data));
  });

  app.patch("/api/websites/:id", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.updateWebsite((req.params.id as string), req.body);
    if (!website) return res.status(404).json({ message: "Not found" });
    return res.json(website);
  });

  app.delete("/api/websites/:id", requireAuth, async (req: Request, res: Response) => {
    await storage.deleteWebsite((req.params.id as string));
    return res.json({ message: "Deleted" });
  });

  // ── Locations ─────────────────────────────────────────────────────────────

  app.get("/api/accounts/:accountId/locations", requireAuth, async (req: Request, res: Response) => {
    const type = req.query.type as string | undefined;
    return res.json(await storage.getLocations((req.params.accountId as string), type));
  });

  app.post("/api/accounts/:accountId/locations", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertLocationSchema.safeParse({ ...req.body, accountId: (req.params.accountId as string) });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    return res.status(201).json(await storage.createLocation(parsed.data));
  });

  app.patch("/api/locations/:id", requireAuth, async (req: Request, res: Response) => {
    const loc = await storage.updateLocation((req.params.id as string), req.body);
    if (!loc) return res.status(404).json({ message: "Not found" });
    return res.json(loc);
  });

  app.delete("/api/locations/:id", requireAuth, async (req: Request, res: Response) => {
    await storage.deleteLocation((req.params.id as string));
    return res.json({ message: "Deleted" });
  });

  app.post("/api/accounts/:accountId/locations/bulk", requireAuth, async (req: Request, res: Response) => {
    const accountId = req.params.accountId as string;
    const rawItems = req.body?.locations;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ message: "locations array required" });
    }
    const bulkItemSchema = insertLocationSchema.omit({ accountId: true });
    type BulkItem = z.infer<typeof bulkItemSchema> & { accountId: string };
    const parsed: BulkItem[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const result = bulkItemSchema.safeParse(rawItems[i]);
      if (!result.success) {
        return res.status(400).json({ message: `Item ${i}: ${result.error.issues[0]?.message ?? "invalid"}` });
      }
      parsed.push({ ...result.data, accountId });
    }
    const { inserted } = await storage.bulkCreateLocations(accountId, parsed);
    return res.json({ inserted, skipped: rawItems.length - inserted });
  });

  // ── Services ──────────────────────────────────────────────────────────────

  app.get("/api/accounts/:accountId/services", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getServices((req.params.accountId as string)));
  });

  app.post("/api/accounts/:accountId/services", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertServiceSchema.safeParse({ ...req.body, accountId: (req.params.accountId as string) });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    return res.status(201).json(await storage.createService(parsed.data));
  });

  app.patch("/api/services/:id", requireAuth, async (req: Request, res: Response) => {
    const svc = await storage.updateService((req.params.id as string), req.body);
    if (!svc) return res.status(404).json({ message: "Not found" });
    return res.json(svc);
  });

  app.delete("/api/services/:id", requireAuth, async (req: Request, res: Response) => {
    await storage.deleteService((req.params.id as string));
    return res.json({ message: "Deleted" });
  });

  // ── Industries ────────────────────────────────────────────────────────────

  app.get("/api/accounts/:accountId/industries", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getIndustries((req.params.accountId as string)));
  });

  app.post("/api/accounts/:accountId/industries", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertIndustrySchema.safeParse({ ...req.body, accountId: (req.params.accountId as string) });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    return res.status(201).json(await storage.createIndustry(parsed.data));
  });

  app.patch("/api/industries/:id", requireAuth, async (req: Request, res: Response) => {
    const ind = await storage.updateIndustry((req.params.id as string), req.body);
    if (!ind) return res.status(404).json({ message: "Not found" });
    return res.json(ind);
  });

  app.delete("/api/industries/:id", requireAuth, async (req: Request, res: Response) => {
    await storage.deleteIndustry((req.params.id as string));
    return res.json({ message: "Deleted" });
  });

  // ── Query Clusters ────────────────────────────────────────────────────────

  app.get("/api/accounts/:accountId/query-clusters", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getQueryClusters((req.params.accountId as string)));
  });

  app.post("/api/accounts/:accountId/query-clusters", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertQueryClusterSchema.safeParse({ ...req.body, accountId: (req.params.accountId as string) });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    return res.status(201).json(await storage.createQueryCluster(parsed.data));
  });

  app.patch("/api/query-clusters/:id", requireAuth, async (req: Request, res: Response) => {
    const qc = await storage.updateQueryCluster((req.params.id as string), req.body);
    if (!qc) return res.status(404).json({ message: "Not found" });
    return res.json(qc);
  });

  // ── Blueprints ────────────────────────────────────────────────────────────

  app.get("/api/accounts/:accountId/blueprints", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getBlueprints((req.params.accountId as string)));
  });

  app.get("/api/blueprints/:id", requireAuth, async (req: Request, res: Response) => {
    const bp = await storage.getBlueprint((req.params.id as string));
    if (!bp) return res.status(404).json({ message: "Not found" });
    return res.json(bp);
  });

  app.post("/api/accounts/:accountId/blueprints", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertBlueprintSchema.safeParse({ ...req.body, accountId: (req.params.accountId as string) });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    return res.status(201).json(await storage.createBlueprint(parsed.data));
  });

  app.patch("/api/blueprints/:id", requireAuth, async (req: Request, res: Response) => {
    const bp = await storage.updateBlueprint((req.params.id as string), req.body);
    if (!bp) return res.status(404).json({ message: "Not found" });
    return res.json(bp);
  });

  app.delete("/api/blueprints/:id", requireAuth, async (req: Request, res: Response) => {
    await storage.deleteBlueprint((req.params.id as string));
    return res.json({ message: "Deleted" });
  });

  // ── Pages ─────────────────────────────────────────────────────────────────

  app.get("/api/websites/:websiteId/pages", requireAuth, async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const pageList = await storage.getPages((req.params.websiteId as string), { status, limit, offset });
    const total = await storage.getPageCount((req.params.websiteId as string), status);
    return res.json({ pages: pageList, total });
  });

  app.get("/api/pages/:id", requireAuth, async (req: Request, res: Response) => {
    const page = await storage.getPage((req.params.id as string));
    if (!page) return res.status(404).json({ message: "Page not found" });
    const versions = await storage.getPageVersions(page.id);
    const activeVersion = versions.find((v) => v.isActive);
    return res.json({ page, versions, activeVersion });
  });

  app.post("/api/websites/:websiteId/pages", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertPageSchema.safeParse({ ...req.body, websiteId: (req.params.websiteId as string) });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    return res.status(201).json(await storage.createPage(parsed.data));
  });

  app.patch("/api/pages/:id", requireAuth, async (req: Request, res: Response) => {
    const page = await storage.updatePage((req.params.id as string), req.body);
    if (!page) return res.status(404).json({ message: "Not found" });
    return res.json(page);
  });

  // Publish a page (admins may force-publish even if QA failed)
  app.post("/api/pages/:id/publish", requireAuth, async (req: Request, res: Response) => {
    const page = await storage.getPage((req.params.id as string));
    if (!page) return res.status(404).json({ message: "Page not found" });

    const updated = await storage.updatePage((req.params.id as string), {
      status: "published",
      publishedAt: new Date(),
    });

    const website = await storage.getWebsite(page.websiteId);
    if (website) {
      await storage.updateWebsite(page.websiteId, {
        publishedPages: (website.publishedPages || 0) + 1,
      } as any);
    }

    return res.json(updated);
  });

  // Bulk-publish all draft/review/approved pages for a website
  app.post("/api/websites/:id/pages/publish-all", requireAuth, async (req: Request, res: Response) => {
    const websiteId = (req.params.id as string);
    const draft = await storage.getPages(websiteId, { status: "draft", limit: 100000 });
    const review = await storage.getPages(websiteId, { status: "review", limit: 100000 });
    const approved = await storage.getPages(websiteId, { status: "approved", limit: 100000 });
    const toPublish = [...draft, ...review, ...approved];

    const now = new Date();
    let count = 0;
    for (const p of toPublish) {
      await storage.updatePage(p.id, { status: "published", publishedAt: now });
      count++;
    }

    const website = await storage.getWebsite(websiteId);
    if (website && count > 0) {
      await storage.updateWebsite(websiteId, {
        publishedPages: (website.publishedPages || 0) + count,
      } as any);
    }

    return res.json({ published: count });
  });

  // Prune a page
  app.post("/api/pages/:id/prune", requireAuth, async (req: Request, res: Response) => {
    const { reason } = req.body;
    const updated = await storage.updatePage((req.params.id as string), {
      status: "pruned",
      pruneReason: reason || "Manual prune",
    });
    return res.json(updated);
  });

  // Approve page for publish queue
  app.post("/api/pages/:id/approve", requireAuth, async (req: Request, res: Response) => {
    const updated = await storage.updatePage((req.params.id as string), { status: "approved" });
    return res.json(updated);
  });

  app.delete("/api/pages/:id", requireAuth, async (req: Request, res: Response) => {
    await storage.deletePage((req.params.id as string));
    return res.json({ message: "Deleted" });
  });

  // ── Generation Jobs ───────────────────────────────────────────────────────

  app.get("/api/websites/:websiteId/jobs", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getGenerationJobs((req.params.websiteId as string)));
  });

  app.get("/api/jobs", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getGenerationJobs());
  });

  app.get("/api/jobs/:id", requireAuth, async (req: Request, res: Response) => {
    const job = await storage.getGenerationJob((req.params.id as string));
    if (!job) return res.status(404).json({ message: "Job not found" });
    return res.json(job);
  });

  app.post("/api/jobs", requireAuth, async (req: Request, res: Response) => {
    const {
      accountId, websiteId, blueprintId, jobName,
      locationIds, serviceIds, industryIds,
    } = req.body;

    if (!accountId || !websiteId || !blueprintId) {
      return res.status(400).json({ message: "accountId, websiteId, blueprintId required" });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ message: "ANTHROPIC_API_KEY not configured" });
    }

    const job = await storage.createGenerationJob({
      accountId,
      websiteId,
      blueprintId,
      name: jobName || `Generation Job ${new Date().toISOString()}`,
      status: "pending",
      totalPages: 0,
      processedPages: 0,
      passedPages: 0,
      failedPages: 0,
    });

    // Run job async — don't await it
    runGenerationJob(job, {
      accountId,
      websiteId,
      blueprintId,
      jobName: job.name,
      locationIds: locationIds || [],
      serviceIds: serviceIds || [],
      industryIds: industryIds || [],
    }).catch((err) => {
      console.error("Generation job failed:", err);
    });

    return res.status(201).json(job);
  });

  app.post("/api/jobs/:id/cancel", requireAuth, async (req: Request, res: Response) => {
    const updated = await storage.updateGenerationJob((req.params.id as string), {
      status: "cancelled",
      completedAt: new Date(),
    });
    return res.json(updated);
  });

  // ── Sitemaps ──────────────────────────────────────────────────────────────

  app.get("/api/websites/:websiteId/sitemaps", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getSitemaps((req.params.websiteId as string)));
  });

  app.post("/api/websites/:websiteId/sitemaps/generate", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.getWebsite((req.params.websiteId as string));
    if (!website) return res.status(404).json({ message: "Website not found" });

    const keys = await generateSitemapsForWebsite((req.params.websiteId as string), website.domain);
    return res.json({ message: "Sitemaps generated", keys });
  });

  // ── SEO Routes (live page rendering) ─────────────────────────────────────

  app.get("/api/websites/:websiteId/sitemap.xml", async (req: Request, res: Response) => {
    const website = await storage.getWebsite((req.params.websiteId as string));
    if (!website) return res.status(404).send("Not found");

    const sitemapList = await storage.getSitemaps((req.params.websiteId as string));
    const baseUrl = `https://${website.domain}`;
    const today = new Date().toISOString().split("T")[0];

    if (sitemapList.length === 0) {
      // Generate inline sitemap
      const publishedPages = await storage.getPages((req.params.websiteId as string), { status: "published", limit: 50000 });
      const urls = publishedPages.map((p) => ({
        loc: `${baseUrl}/${p.slug}`,
        lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0],
        priority: "0.7",
      }));
      const { buildSitemapXml } = await import("./services/sitemap");
      res.setHeader("Content-Type", "application/xml");
      return res.send(buildSitemapXml(urls));
    }

    const { buildSitemapIndexXml } = await import("./services/sitemap");
    const indexXml = buildSitemapIndexXml(
      sitemapList.map((sm) => ({
        loc: `${baseUrl}/${sm.slug}.xml`,
        lastmod: today,
      }))
    );
    res.setHeader("Content-Type", "application/xml");
    return res.send(indexXml);
  });

  app.get("/api/websites/:websiteId/robots.txt", async (req: Request, res: Response) => {
    const website = await storage.getWebsite((req.params.websiteId as string));
    if (!website) return res.status(404).send("Not found");

    if (website.robotsTxt) {
      res.setHeader("Content-Type", "text/plain");
      return res.send(website.robotsTxt);
    }

    res.setHeader("Content-Type", "text/plain");
    return res.send(generateRobotsTxt(website.domain));
  });

  // ── System Info ───────────────────────────────────────────────────────────

  // ── Public Page Serving ──────────────────────────────────────────────────
  // Serves published pages at /sites/:domain/:slug as full HTML
  app.get("/sites/:domain/:slug", async (req: Request, res: Response) => {
    const website = await storage.getWebsiteByDomain((req.params.domain as string));
    if (!website) return res.status(404).send(notFoundHtml("Website not found"));

    const page = await storage.getPageBySlug(website.id, (req.params.slug as string));
    if (!page || page.status !== "published") {
      return res.status(404).send(notFoundHtml("Page not found or not yet published"));
    }

    // Get active content version
    const version = await storage.getActivePageVersion(page.id);

    // Get brand profile for branding
    const brandProfiles = await storage.getBrandProfiles(website.accountId);
    const brand = brandProfiles[0];

    const html = renderPageHtml(page, version, website, brand);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(html);
  });

  // ── AI Endpoints ─────────────────────────────────────────────────────────

  app.post("/api/ai/suggest-services", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ message: "ANTHROPIC_API_KEY not configured" });
    }
    const { businessName, websiteUrl, industry, existingServices } = req.body;
    if (!businessName || !industry) {
      return res.status(400).json({ message: "businessName and industry are required" });
    }
    try {
      const services = await suggestServices({ businessName, websiteUrl, industry, existingServices });
      return res.json(services);
    } catch (err: any) {
      return res.status(500).json({ message: err.message || "Service suggestion failed" });
    }
  });

  app.post("/api/ai/generate-blueprint", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ message: "ANTHROPIC_API_KEY not configured" });
    }
    const { businessName, industry, serviceName, pageType, extraContext } = req.body;
    if (!businessName || !industry || !pageType) {
      return res.status(400).json({ message: "businessName, industry, and pageType are required" });
    }
    try {
      const blueprint = await generateBlueprint({ businessName, industry, serviceName, pageType, extraContext });
      return res.json(blueprint);
    } catch (err: any) {
      return res.status(500).json({ message: err.message || "Blueprint generation failed" });
    }
  });

  app.get("/api/system/status", requireAuth, async (req: Request, res: Response) => {
    return res.json({
      claudeConfigured: !!process.env.ANTHROPIC_API_KEY,
      r2Configured: isR2Configured(),
      appBaseUrl: process.env.APP_BASE_URL || null,
    });
  });

  // ── Custom Domain Handler ─────────────────────────────────────────────────
  // When a request arrives with a Host header matching a registered website
  // domain (e.g. local.spotonresults.com), serve white-pages directly at /{slug}
  // instead of requiring the /sites/{domain}/{slug} path.
  const PLATFORM_SUFFIXES = [".replit.app", ".replit.dev", ".repl.co", ".worf.replit.dev", ".janeway.replit.dev"];

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("[domain-mw] raw host header:", req.headers.host, "path:", req.path);
      // Strip port from host header
      const host = (req.headers.host || "").split(":")[0].toLowerCase().trim();

      // Skip Replit platform domains, localhost, and internal asset paths
      if (!host
        || host === "localhost"
        || host === "0.0.0.0"
        || PLATFORM_SUFFIXES.some(s => host.endsWith(s))
        || req.path.startsWith("/api/")
        || req.path.startsWith("/sites/")
        || req.path.startsWith("/@")
        || req.path.startsWith("/src/")
        || req.path.startsWith("/__")
        || req.path.startsWith("/node_modules/")
      ) {
        return next();
      }

      // Look up website by the incoming domain
      const website = await storage.getWebsiteByDomain(host);
      if (!website) return next(); // unknown domain — fall through to admin app

      const rawSlug = req.path.replace(/^\//, "").replace(/\/$/, "");

      // Sitemap
      if (rawSlug === "sitemap.xml" || rawSlug === "sitemap_index.xml" || rawSlug === "sitemap") {
        return res.redirect(301, `/api/websites/${website.id}/sitemap.xml`);
      }

      // Robots.txt
      if (rawSlug === "robots.txt") {
        return res.redirect(301, `/api/websites/${website.id}/robots.txt`);
      }

      // Root — show a simple page index for the domain
      if (!rawSlug) {
        const pages = await storage.getPages(website.id, { status: "published", limit: 50 });
        const total = await storage.getPageCount(website.id, "published");
        const brand = (await storage.getBrandProfiles(website.accountId))[0];
        const brandName = brand?.name || website.domain;
        const primaryColor = brand?.primaryColor || "#2563eb";
        const listHtml = (pages as any[]).map((p: any) =>
          `<li><a href="/${p.slug}">${p.title}</a></li>`
        ).join("\n");
        const moreNote = total > 50 ? `<p style="color:#6b7280;font-size:.85rem">${total - 50} more pages available.</p>` : "";
        return res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
<title>${brandName}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1.5rem;color:#1f2937}
h1{color:${primaryColor}}a{color:${primaryColor}}ul{line-height:2}</style></head>
<body><h1>${brandName}</h1><p>Published pages on this domain:</p><ul>${listHtml}</ul>${moreNote}</body></html>`);
      }

      // Serve a specific page by slug
      const page = await storage.getPageBySlug(website.id, rawSlug);
      if (!page || page.status !== "published") {
        return res.status(404).send(notFoundHtml("Page not found or not yet published"));
      }

      const version = await storage.getActivePageVersion(page.id);
      const brandProfiles = await storage.getBrandProfiles(website.accountId);
      const brand = brandProfiles[0];
      const html = renderPageHtml(page, version, website, brand);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(html);
    } catch (err) {
      return next(err);
    }
  });

  return httpServer;
}
