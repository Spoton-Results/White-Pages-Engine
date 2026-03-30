import { db } from "./db";
import { eq, and, desc, asc, ilike, sql, count, inArray, or } from "drizzle-orm";
import {
  accounts, users, brandProfiles, websites, locations, services, industries,
  queryClusters, blueprints, pages, pageVersions, internalLinks,
  generationJobs, sitemaps, pageMetrics, contentVariationBanks, stateData,
  type Account, type InsertAccount,
  type User, type InsertUser,
  type BrandProfile, type InsertBrandProfile,
  type Website, type InsertWebsite,
  type Location, type InsertLocation,
  type Service, type InsertService,
  type Industry, type InsertIndustry,
  type QueryCluster, type InsertQueryCluster,
  type Blueprint, type InsertBlueprint,
  type Page, type InsertPage,
  type PageVersion, type InsertPageVersion,
  type GenerationJob, type InsertGenerationJob,
  type Sitemap, type InsertSitemap,
  type PageMetric, type InsertPageMetric,
  type ContentVariationBank, type InsertContentVariationBank,
  type StateData, type InsertStateData,
} from "@shared/schema";

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function getAccounts(): Promise<Account[]> {
  return db.select().from(accounts).orderBy(desc(accounts.createdAt));
}

export async function getAccount(id: string): Promise<Account | undefined> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id));
  return row;
}

export async function getAccountBySlug(slug: string): Promise<Account | undefined> {
  const [row] = await db.select().from(accounts).where(eq(accounts.slug, slug));
  return row;
}

export async function createAccount(data: InsertAccount): Promise<Account> {
  const [row] = await db.insert(accounts).values(data).returning();
  return row;
}

export async function updateAccount(id: string, data: Partial<InsertAccount>): Promise<Account | undefined> {
  const [row] = await db.update(accounts).set({ ...data, updatedAt: new Date() }).where(eq(accounts.id, id)).returning();
  return row;
}

export async function deleteAccount(id: string): Promise<void> {
  await db.delete(accounts).where(eq(accounts.id, id));
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUser(id: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.username, username));
  return row;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row;
}

export async function getUsersByAccount(accountId: string): Promise<User[]> {
  return db.select().from(users).where(eq(users.accountId, accountId));
}

export async function createUser(data: InsertUser): Promise<User> {
  const [row] = await db.insert(users).values(data).returning();
  return row;
}

export async function getSuperAdminUsers(): Promise<User[]> {
  return db.select().from(users).where(eq(users.isSuperAdmin, true));
}

export async function updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
  const [row] = await db.update(users).set(data).where(eq(users.id, id)).returning();
  return row;
}

// ─── Brand Profiles ───────────────────────────────────────────────────────────

export async function getBrandProfiles(accountId: string): Promise<BrandProfile[]> {
  return db.select().from(brandProfiles).where(eq(brandProfiles.accountId, accountId));
}

export async function getBrandProfile(id: string): Promise<BrandProfile | undefined> {
  const [row] = await db.select().from(brandProfiles).where(eq(brandProfiles.id, id));
  return row;
}

export async function createBrandProfile(data: InsertBrandProfile): Promise<BrandProfile> {
  const [row] = await db.insert(brandProfiles).values(data).returning();
  return row;
}

export async function updateBrandProfile(id: string, data: Partial<InsertBrandProfile>): Promise<BrandProfile | undefined> {
  const [row] = await db.update(brandProfiles).set({ ...data, updatedAt: new Date() }).where(eq(brandProfiles.id, id)).returning();
  return row;
}

export async function deleteBrandProfile(id: string): Promise<void> {
  await db.delete(brandProfiles).where(eq(brandProfiles.id, id));
}

// ─── Websites ─────────────────────────────────────────────────────────────────

export async function getWebsites(accountId?: string): Promise<Website[]> {
  if (accountId) {
    return db.select().from(websites).where(eq(websites.accountId, accountId)).orderBy(desc(websites.createdAt));
  }
  return db.select().from(websites).orderBy(desc(websites.createdAt));
}

export async function getWebsite(id: string): Promise<Website | undefined> {
  const [row] = await db.select().from(websites).where(eq(websites.id, id));
  return row;
}

export async function getWebsiteByDomain(domain: string): Promise<Website | undefined> {
  const stripped = domain.startsWith("www.") ? domain.slice(4) : domain;
  const withWww = `www.${stripped}`;
  const [row] = await db.select().from(websites).where(
    or(eq(websites.domain, stripped), eq(websites.domain, withWww))
  );
  return row;
}

export async function createWebsite(data: InsertWebsite): Promise<Website> {
  const [row] = await db.insert(websites).values(data).returning();
  return row;
}

export async function updateWebsite(id: string, data: Partial<InsertWebsite>): Promise<Website | undefined> {
  const [row] = await db.update(websites).set({ ...data, updatedAt: new Date() }).where(eq(websites.id, id)).returning();
  return row;
}

export async function deleteWebsite(id: string): Promise<void> {
  await db.delete(websites).where(eq(websites.id, id));
}

// ─── Locations ────────────────────────────────────────────────────────────────

export async function getLocations(accountId: string, type?: string): Promise<Location[]> {
  if (type) {
    return db.select().from(locations).where(and(eq(locations.accountId, accountId), eq(locations.type, type as any))).orderBy(asc(locations.name));
  }
  return db.select().from(locations).where(eq(locations.accountId, accountId)).orderBy(asc(locations.type), asc(locations.name));
}

export async function getLocation(id: string): Promise<Location | undefined> {
  const [row] = await db.select().from(locations).where(eq(locations.id, id));
  return row;
}

export async function createLocation(data: InsertLocation): Promise<Location> {
  const [row] = await db.insert(locations).values(data).returning();
  return row;
}

export async function updateLocation(id: string, data: Partial<InsertLocation>): Promise<Location | undefined> {
  const [row] = await db.update(locations).set(data).where(eq(locations.id, id)).returning();
  return row;
}

export async function deleteLocation(id: string): Promise<void> {
  await db.delete(locations).where(eq(locations.id, id));
}

export async function bulkCreateLocations(accountId: string, items: InsertLocation[]): Promise<{ inserted: number }> {
  if (!items.length) return { inserted: 0 };
  const existing = await db.select({ slug: locations.slug }).from(locations).where(eq(locations.accountId, accountId));
  const existingSlugs = new Set(existing.map(r => r.slug));
  const seenInPayload = new Set<string>();
  const toInsert = items.filter(loc => {
    if (existingSlugs.has(loc.slug) || seenInPayload.has(loc.slug)) return false;
    seenInPayload.add(loc.slug);
    return true;
  });
  if (!toInsert.length) return { inserted: 0 };
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const rows = await db.insert(locations).values(chunk).returning({ id: locations.id });
    inserted += rows.length;
  }
  return { inserted };
}

// ─── Services ─────────────────────────────────────────────────────────────────

export async function getServices(accountId: string): Promise<Service[]> {
  return db.select().from(services).where(eq(services.accountId, accountId)).orderBy(asc(services.name));
}

export async function getService(id: string): Promise<Service | undefined> {
  const [row] = await db.select().from(services).where(eq(services.id, id));
  return row;
}

export async function createService(data: InsertService): Promise<Service> {
  const [row] = await db.insert(services).values(data).returning();
  return row;
}

export async function updateService(id: string, data: Partial<InsertService>): Promise<Service | undefined> {
  const [row] = await db.update(services).set(data).where(eq(services.id, id)).returning();
  return row;
}

export async function deleteService(id: string): Promise<void> {
  await db.delete(services).where(eq(services.id, id));
}

// ─── Industries ───────────────────────────────────────────────────────────────

export async function getIndustries(accountId: string): Promise<Industry[]> {
  return db.select().from(industries).where(eq(industries.accountId, accountId)).orderBy(asc(industries.name));
}

export async function getIndustry(id: string): Promise<Industry | undefined> {
  const [row] = await db.select().from(industries).where(eq(industries.id, id));
  return row;
}

export async function createIndustry(data: InsertIndustry): Promise<Industry> {
  const [row] = await db.insert(industries).values(data).returning();
  return row;
}

export async function updateIndustry(id: string, data: Partial<InsertIndustry>): Promise<Industry | undefined> {
  const [row] = await db.update(industries).set(data).where(eq(industries.id, id)).returning();
  return row;
}

export async function deleteIndustry(id: string): Promise<void> {
  await db.delete(industries).where(eq(industries.id, id));
}

// ─── Query Clusters ───────────────────────────────────────────────────────────

export async function getQueryClusters(accountId: string): Promise<QueryCluster[]> {
  return db.select().from(queryClusters).where(eq(queryClusters.accountId, accountId)).orderBy(asc(queryClusters.name));
}

export async function getQueryCluster(id: string): Promise<QueryCluster | undefined> {
  const [row] = await db.select().from(queryClusters).where(eq(queryClusters.id, id));
  return row;
}

export async function createQueryCluster(data: InsertQueryCluster): Promise<QueryCluster> {
  const [row] = await db.insert(queryClusters).values(data).returning();
  return row;
}

export async function updateQueryCluster(id: string, data: Partial<InsertQueryCluster>): Promise<QueryCluster | undefined> {
  const [row] = await db.update(queryClusters).set(data).where(eq(queryClusters.id, id)).returning();
  return row;
}

export async function deleteQueryCluster(id: string): Promise<void> {
  await db.delete(queryClusters).where(eq(queryClusters.id, id));
}

// ─── Blueprints ───────────────────────────────────────────────────────────────

export async function getBlueprints(accountId: string): Promise<Blueprint[]> {
  return db.select().from(blueprints).where(eq(blueprints.accountId, accountId)).orderBy(desc(blueprints.createdAt));
}

export async function getBlueprint(id: string): Promise<Blueprint | undefined> {
  const [row] = await db.select().from(blueprints).where(eq(blueprints.id, id));
  return row;
}

export async function createBlueprint(data: InsertBlueprint): Promise<Blueprint> {
  const [row] = await db.insert(blueprints).values(data).returning();
  return row;
}

export async function updateBlueprint(id: string, data: Partial<InsertBlueprint>): Promise<Blueprint | undefined> {
  const [row] = await db.update(blueprints).set({ ...data, updatedAt: new Date() }).where(eq(blueprints.id, id)).returning();
  return row;
}

export async function deleteBlueprint(id: string): Promise<void> {
  await db.delete(blueprints).where(eq(blueprints.id, id));
}

// ─── Pages ────────────────────────────────────────────────────────────────────

export async function getPages(websiteId: string, opts?: { status?: string; limit?: number; offset?: number }): Promise<Page[]> {
  let query = db.select().from(pages).where(eq(pages.websiteId, websiteId));
  if (opts?.status) {
    return db.select().from(pages).where(and(eq(pages.websiteId, websiteId), eq(pages.status, opts.status as any))).orderBy(desc(pages.updatedAt)).limit(opts.limit || 100).offset(opts.offset || 0);
  }
  return db.select().from(pages).where(eq(pages.websiteId, websiteId)).orderBy(desc(pages.updatedAt)).limit(opts?.limit || 100).offset(opts?.offset || 0);
}

export async function getPage(id: string): Promise<Page | undefined> {
  const [row] = await db.select().from(pages).where(eq(pages.id, id));
  return row;
}

export async function getPageBySlug(websiteId: string, slug: string): Promise<Page | undefined> {
  const [row] = await db.select().from(pages).where(and(eq(pages.websiteId, websiteId), eq(pages.slug, slug)));
  return row;
}

export async function createPage(data: InsertPage): Promise<Page> {
  const [row] = await db.insert(pages).values(data).returning();
  return row;
}

export async function updatePage(id: string, data: Partial<InsertPage>): Promise<Page | undefined> {
  const [row] = await db.update(pages).set({ ...data, updatedAt: new Date() }).where(eq(pages.id, id)).returning();
  return row;
}

export async function deletePage(id: string): Promise<void> {
  await db.delete(pages).where(eq(pages.id, id));
}

export async function getPageCount(websiteId: string, status?: string): Promise<number> {
  const cond = status 
    ? and(eq(pages.websiteId, websiteId), eq(pages.status, status as any))
    : eq(pages.websiteId, websiteId);
  const [result] = await db.select({ count: count() }).from(pages).where(cond);
  return result.count;
}

// ─── Page Versions ────────────────────────────────────────────────────────────

export async function getPageVersions(pageId: string): Promise<PageVersion[]> {
  return db.select().from(pageVersions).where(eq(pageVersions.pageId, pageId)).orderBy(desc(pageVersions.version));
}

export async function getActivePageVersion(pageId: string): Promise<PageVersion | undefined> {
  const [row] = await db.select().from(pageVersions).where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.isActive, true)));
  return row;
}

export async function createPageVersion(data: InsertPageVersion): Promise<PageVersion> {
  const [row] = await db.insert(pageVersions).values(data).returning();
  return row;
}

export async function setActivePageVersion(pageId: string, versionId: string): Promise<void> {
  await db.update(pageVersions).set({ isActive: false }).where(eq(pageVersions.pageId, pageId));
  await db.update(pageVersions).set({ isActive: true }).where(eq(pageVersions.id, versionId));
}

// ─── Generation Jobs ─────────────────────────────────────────────────────────

export async function getGenerationJobs(websiteId?: string): Promise<GenerationJob[]> {
  if (websiteId) {
    return db.select().from(generationJobs).where(eq(generationJobs.websiteId, websiteId)).orderBy(desc(generationJobs.createdAt));
  }
  return db.select().from(generationJobs).orderBy(desc(generationJobs.createdAt));
}

export async function getGenerationJob(id: string): Promise<GenerationJob | undefined> {
  const [row] = await db.select().from(generationJobs).where(eq(generationJobs.id, id));
  return row;
}

export async function createGenerationJob(data: InsertGenerationJob): Promise<GenerationJob> {
  const [row] = await db.insert(generationJobs).values(data).returning();
  return row;
}

export async function updateGenerationJob(id: string, data: Partial<InsertGenerationJob>): Promise<GenerationJob | undefined> {
  const [row] = await db.update(generationJobs).set(data).where(eq(generationJobs.id, id)).returning();
  return row;
}

// ─── Sitemaps ─────────────────────────────────────────────────────────────────

export async function getSitemaps(websiteId: string): Promise<Sitemap[]> {
  return db.select().from(sitemaps).where(eq(sitemaps.websiteId, websiteId)).orderBy(asc(sitemaps.name));
}

export async function getSitemap(id: string): Promise<Sitemap | undefined> {
  const [row] = await db.select().from(sitemaps).where(eq(sitemaps.id, id));
  return row;
}

export async function upsertSitemap(data: InsertSitemap): Promise<Sitemap> {
  const existing = await db.select().from(sitemaps).where(and(eq(sitemaps.websiteId, data.websiteId), eq(sitemaps.slug, data.slug)));
  if (existing.length > 0) {
    const [row] = await db.update(sitemaps).set({ ...data, updatedAt: new Date() }).where(eq(sitemaps.id, existing[0].id)).returning();
    return row;
  }
  const [row] = await db.insert(sitemaps).values(data).returning();
  return row;
}

// ─── Page Metrics ─────────────────────────────────────────────────────────────

export async function getPageMetrics(pageId: string, days = 30): Promise<PageMetric[]> {
  return db.select().from(pageMetrics).where(eq(pageMetrics.pageId, pageId)).orderBy(desc(pageMetrics.date)).limit(days);
}

export async function upsertPageMetric(data: InsertPageMetric): Promise<PageMetric> {
  const [row] = await db.insert(pageMetrics).values(data).returning();
  return row;
}

export async function getWebsiteMetricsSummary(websiteId: string) {
  const result = await db
    .select({
      totalImpressions: sql<number>`sum(${pageMetrics.impressions})`,
      totalClicks: sql<number>`sum(${pageMetrics.clicks})`,
      avgPosition: sql<number>`avg(${pageMetrics.avgPosition})`,
    })
    .from(pageMetrics)
    .where(eq(pageMetrics.websiteId, websiteId));
  return result[0];
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const [accountCount] = await db.select({ count: count() }).from(accounts);
  const [websiteCount] = await db.select({ count: count() }).from(websites);
  const [publishedCount] = await db.select({ count: count() }).from(pages).where(eq(pages.status, "published"));
  const [draftCount] = await db.select({ count: count() }).from(pages).where(eq(pages.status, "draft"));
  const [reviewCount] = await db.select({ count: count() }).from(pages).where(eq(pages.status, "review"));
  const [jobCount] = await db.select({ count: count() }).from(generationJobs).where(eq(generationJobs.status, "running"));

  return {
    totalAccounts: accountCount.count,
    totalWebsites: websiteCount.count,
    publishedPages: publishedCount.count,
    draftPages: draftCount.count,
    reviewPages: reviewCount.count,
    activeJobs: jobCount.count,
  };
}

export async function getRecentActivity(limit = 20) {
  const recentJobs = await db.select().from(generationJobs).orderBy(desc(generationJobs.createdAt)).limit(limit);
  const recentPages = await db.select().from(pages).orderBy(desc(pages.updatedAt)).limit(limit);
  return { recentJobs, recentPages };
}

// ─── Variation Banks ──────────────────────────────────────────────────────────

export async function getVariationBanks(websiteId: string, service: string): Promise<ContentVariationBank[]> {
  return db.select().from(contentVariationBanks)
    .where(and(eq(contentVariationBanks.websiteId, websiteId), eq(contentVariationBanks.service, service)));
}

export async function getVariationBankServices(websiteId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ service: contentVariationBanks.service })
    .from(contentVariationBanks)
    .where(eq(contentVariationBanks.websiteId, websiteId));
  return rows.map(r => r.service);
}

export async function createVariationBank(data: InsertContentVariationBank): Promise<ContentVariationBank> {
  const [row] = await db.insert(contentVariationBanks).values(data).returning();
  return row;
}

export async function deleteVariationBanks(websiteId: string, service: string): Promise<void> {
  await db.delete(contentVariationBanks)
    .where(and(eq(contentVariationBanks.websiteId, websiteId), eq(contentVariationBanks.service, service)));
}

// ─── State Data ───────────────────────────────────────────────────────────────

export async function getStateDataByAbbr(abbr: string): Promise<StateData | undefined> {
  const [row] = await db.select().from(stateData).where(eq(stateData.stateAbbr, abbr.toUpperCase()));
  return row;
}

export async function getStateDataByName(name: string): Promise<StateData | undefined> {
  const [row] = await db.select().from(stateData).where(ilike(stateData.stateName, name));
  return row;
}

export async function getStateDataCount(): Promise<number> {
  const [{ c }] = await db.select({ c: count() }).from(stateData);
  return Number(c);
}

export async function insertStateData(data: InsertStateData): Promise<StateData> {
  const [row] = await db.insert(stateData).values(data).returning();
  return row;
}

// Re-export IStorage interface for backwards compatibility
export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

export const storage = { getUser, getUserByUsername, createUser };
