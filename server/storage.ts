import { db, pool } from "./db";
import { randomBytes } from "crypto";
import { eq, and, desc, asc, ilike, sql, count, inArray, or, gte, isNull, lt, lte } from "drizzle-orm";
import {
  agencies, accounts, users, brandProfiles, websites, locations, services, industries,
  queryClusters, blueprints, pages, pageVersions, internalLinks,
  generationJobs, sitemaps, pageMetrics, contentVariationBanks, stateData, leads,
  fallbackHitLogs, variationBankCompleteness, hubPages,
  adminNotifications, demotionLogs,
  type Agency, type InsertAgency,
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
  type Lead, type InsertLead,
  type FallbackHitLog,
  type VariationBankCompleteness, type InsertVariationBankCompleteness,
  type HubPage, type InsertHubPage,
  type AdminNotification, type InsertAdminNotification,
  type DemotionLog, type InsertDemotionLog,
} from "@shared/schema";

// ─── Agencies ─────────────────────────────────────────────────────────────────

export async function getAgencies(): Promise<Agency[]> {
  return db.select().from(agencies).orderBy(asc(agencies.name));
}

export async function getAgency(id: string): Promise<Agency | undefined> {
  const [row] = await db.select().from(agencies).where(eq(agencies.id, id));
  return row;
}

export async function createAgency(data: InsertAgency): Promise<Agency> {
  const [row] = await db.insert(agencies).values(data).returning();
  return row;
}

export async function updateAgency(id: string, data: Partial<InsertAgency>): Promise<Agency | undefined> {
  const [row] = await db.update(agencies).set(data).where(eq(agencies.id, id)).returning();
  return row;
}

export async function deleteAgency(id: string): Promise<void> {
  await db.delete(agencies).where(eq(agencies.id, id));
}

export async function getAgencyAccounts(agencyId: string): Promise<Account[]> {
  // Use raw SQL to avoid Drizzle ORM camelCase→snake_case issues in production
  const res = await pool.query(
    `SELECT * FROM accounts WHERE agency_id = $1 ORDER BY name ASC`,
    [agencyId]
  );
  // Map snake_case columns back to camelCase to match Account type
  return res.rows.map((r: any) => ({
    ...r,
    agencyId: r.agency_id,
    clientStatus: r.client_status,
    reportToken: r.report_token,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })) as Account[];
}

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
  const values = { ...data };
  if (!values.reportToken) {
    values.reportToken = randomBytes(16).toString("hex");
  }
  const [row] = await db.insert(accounts).values(values).returning();
  return row;
}

export async function updateAccount(id: string, data: Partial<InsertAccount>): Promise<Account | undefined> {
  const [row] = await db.update(accounts).set({ ...data, updatedAt: new Date() }).where(eq(accounts.id, id)).returning();
  return row;
}

export async function deleteAccount(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Collect website IDs for this account
    const acctWebsites = await tx.select({ id: websites.id }).from(websites).where(eq(websites.accountId, id));
    const websiteIds = acctWebsites.map(w => w.id);

    if (websiteIds.length > 0) {
      // 2. Delete generationJobs — websiteId FK has no onDelete action and would block website deletion
      await tx.delete(generationJobs).where(inArray(generationJobs.websiteId, websiteIds));

      // 3. Collect page IDs so we can delete internalLinks (fromPageId/toPageId have no cascade)
      const acctPages = await tx.select({ id: pages.id }).from(pages).where(inArray(pages.websiteId, websiteIds));
      const pageIds = acctPages.map(p => p.id);

      if (pageIds.length > 0) {
        // 4. Remove internalLinks — fromPageId/toPageId have no onDelete action
        await tx.delete(internalLinks).where(or(inArray(internalLinks.fromPageId, pageIds), inArray(internalLinks.toPageId, pageIds)));

        // 5. Null out blueprintId on pages — FK has no onDelete action
        await tx.update(pages).set({ blueprintId: null }).where(inArray(pages.id, pageIds));
      }
    }

    // 6. Delete the account — all remaining FKs have onDelete: "cascade"
    await tx.delete(accounts).where(eq(accounts.id, id));
  });
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
  const cached = brandProfilesCache.get(accountId);
  if (cached && Date.now() < cached.exp) return cached.data;
  const data = await db.select().from(brandProfiles).where(eq(brandProfiles.accountId, accountId));
  brandProfilesCache.set(accountId, { data, exp: Date.now() + NAV_CACHE_TTL });
  return data;
}

export function invalidateBrandProfilesCache(accountId: string) {
  brandProfilesCache.delete(accountId);
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
  if (row) brandProfilesCache.delete(row.accountId);
  return row;
}

export async function deleteBrandProfile(id: string): Promise<void> {
  // websites.brandProfileId has no cascade — null out before deleting
  await db.update(websites).set({ brandProfileId: null }).where(eq(websites.brandProfileId, id));
  const [deleted] = await db.delete(brandProfiles).where(eq(brandProfiles.id, id)).returning();
  if (deleted) brandProfilesCache.delete(deleted.accountId);
}

// ─── Websites ─────────────────────────────────────────────────────────────────

// Helper to map raw DB snake_case rows to Website camelCase type
function mapWebsiteRow(r: any): Website {
  return {
    id: r.id,
    accountId: r.account_id,
    brandProfileId: r.brand_profile_id,
    name: r.name,
    domain: r.domain,
    subdomain: r.subdomain,
    status: r.status,
    primaryColor: r.primary_color,
    secondaryColor: r.secondary_color,
    settings: r.settings,
    publishedPages: r.published_pages,
    pageCount: r.page_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as Website;
}

export async function getWebsites(accountId?: string): Promise<Website[]> {
  const { pool } = await import("./db");
  if (accountId) {
    // Raw SQL to avoid Drizzle ORM camelCase→snake_case bug with account_id column in production
    const res = await pool.query(
      `SELECT * FROM websites WHERE account_id = $1 ORDER BY created_at DESC`,
      [accountId]
    );
    return res.rows.map(mapWebsiteRow);
  }
  // Use raw SQL for the all-websites path too — same Drizzle camelCase→snake_case
  // bug affects account_id, published_pages, brand_profile_id etc. in production builds.
  const res = await pool.query(`SELECT * FROM websites ORDER BY created_at DESC`);
  return res.rows.map(mapWebsiteRow);
}

export async function getWebsite(id: string): Promise<Website | undefined> {
  const [row] = await db.select().from(websites).where(eq(websites.id, id));
  return row;
}

// 5-minute cache for domain → website lookups (biggest perf win for crawler traffic)
const websiteByDomainCache = new Map<string, { website: Website | undefined; exp: number }>();
export function invalidateWebsiteDomainCache(domain: string) {
  const stripped = domain.toLowerCase().replace(/^www\./, "");
  websiteByDomainCache.delete(stripped);
}

export async function getWebsiteByDomain(domain: string): Promise<Website | undefined> {
  const stripped = domain.toLowerCase().replace(/^www\./, "");
  const cached = websiteByDomainCache.get(stripped);
  if (cached && Date.now() < cached.exp) return cached.website;

  const withWww = `www.${stripped}`;
  const [row] = await db.select().from(websites).where(
    or(
      eq(sql`lower(${websites.domain})`, stripped),
      eq(sql`lower(${websites.domain})`, withWww),
    )
  );
  websiteByDomainCache.set(stripped, { website: row, exp: Date.now() + 5 * 60_000 });
  return row;
}

export async function createWebsite(data: InsertWebsite): Promise<Website> {
  const normalized = data.domain ? { ...data, domain: data.domain.toLowerCase().trim() } : data;
  const [row] = await db.insert(websites).values(normalized).returning();
  return row;
}

export async function syncWebsitePublishedCount(websiteId: string): Promise<void> {
  const [liveCount] = await db.select({ n: count() }).from(pages).where(and(eq(pages.websiteId, websiteId), eq(pages.status, "published")));
  await db.update(websites).set({ publishedPages: liveCount.n, updatedAt: new Date() }).where(eq(websites.id, websiteId));
}

export async function updateWebsite(id: string, data: Partial<InsertWebsite>): Promise<Website | undefined> {
  const normalized = data.domain ? { ...data, domain: data.domain.toLowerCase().trim() } : data;
  const [row] = await db.update(websites).set({ ...normalized, updatedAt: new Date() }).where(eq(websites.id, id)).returning();
  return row;
}

export async function deleteWebsite(id: string): Promise<void> {
  // pages.blueprintId has no cascade — null out before deleting blueprints for this site
  await db.update(pages).set({ blueprintId: null }).where(eq(pages.websiteId, id));
  // Manually clean up tables that lack onDelete: "cascade" on websiteId
  await db.delete(pageMetrics).where(eq(pageMetrics.websiteId, id));
  await db.delete(generationJobs).where(eq(generationJobs.websiteId, id));
  await db.delete(blueprints).where(eq(blueprints.websiteId, id));
  // internalLinks fromPageId/toPageId have no cascade — delete by websiteId first
  await db.delete(internalLinks).where(eq(internalLinks.websiteId, id));
  await db.delete(websites).where(eq(websites.id, id));
}

// ─── Locations ────────────────────────────────────────────────────────────────

export async function getLocations(accountId: string, type?: string, orderBy?: string, limit?: number, offset?: number, search?: string, cityTier?: number): Promise<Location[]> {
  const conditions = [eq(locations.accountId, accountId)];
  if (type) conditions.push(eq(locations.type, type as any));
  if (search) conditions.push(ilike(locations.name, `%${search}%`));
  if (cityTier) conditions.push(eq(locations.cityTier, cityTier));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const order = orderBy === "population"
    ? [desc(locations.population)]
    : type
      ? [asc(locations.name)]
      : [asc(locations.type), asc(locations.name)];
  let q: any = db.select().from(locations).where(where).orderBy(...order);
  if (limit) q = q.limit(limit);
  if (offset) q = q.offset(offset);
  return q;
}

export async function countLocations(accountId: string, type?: string, search?: string, cityTier?: number): Promise<number> {
  const conditions = [eq(locations.accountId, accountId)];
  if (type) conditions.push(eq(locations.type, type as any));
  if (search) conditions.push(ilike(locations.name, `%${search}%`));
  if (cityTier) conditions.push(eq(locations.cityTier, cityTier));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(locations).where(where);
  return row?.count ?? 0;
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
  // pages.locationId has no cascade — null out before deleting
  await db.update(pages).set({ locationId: null }).where(eq(pages.locationId, id));
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
  // pages.serviceId and queryClusters.serviceId have no cascade — null out before deleting
  await db.update(pages).set({ serviceId: null }).where(eq(pages.serviceId, id));
  await db.update(queryClusters).set({ serviceId: null }).where(eq(queryClusters.serviceId, id));
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
  // pages.industryId has no cascade — null out before deleting
  await db.update(pages).set({ industryId: null }).where(eq(pages.industryId, id));
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
  // pages.queryClusterId has no cascade — null out before deleting
  await db.update(pages).set({ queryClusterId: null }).where(eq(pages.queryClusterId, id));
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
  // pages.blueprintId and generationJobs.blueprintId have no cascade — null out before deleting
  await db.update(pages).set({ blueprintId: null }).where(eq(pages.blueprintId, id));
  await db.update(generationJobs).set({ blueprintId: null }).where(eq(generationJobs.blueprintId, id));
  await db.delete(blueprints).where(eq(blueprints.id, id));
}

export async function bulkDeleteBlueprints(accountId: string): Promise<number> {
  const ids = await db.select({ id: blueprints.id }).from(blueprints).where(eq(blueprints.accountId, accountId));
  if (ids.length === 0) return 0;
  const idList = ids.map(r => r.id);
  await db.transaction(async (tx) => {
    await tx.update(pages).set({ blueprintId: null }).where(inArray(pages.blueprintId, idList));
    await tx.update(generationJobs).set({ blueprintId: null }).where(inArray(generationJobs.blueprintId, idList));
    await tx.delete(blueprints).where(eq(blueprints.accountId, accountId));
  });
  return idList.length;
}

// ─── Pages ────────────────────────────────────────────────────────────────────

export async function getPagesForIndexing(websiteId: string, offset: number, limit: number): Promise<{ rows: Page[]; total: number }> {
  const rows = await db.select().from(pages)
    .where(and(eq(pages.websiteId, websiteId), eq(pages.status, "published")))
    .orderBy(
      sql`CASE WHEN page_type = 'state_hub' THEN 0 WHEN page_type = 'city_hub' THEN 1 ELSE 2 END`,
      desc(pages.updatedAt),
    )
    .limit(limit)
    .offset(offset);
  const [{ value }] = await db.select({ value: count() }).from(pages)
    .where(and(eq(pages.websiteId, websiteId), eq(pages.status, "published")));
  return { rows, total: Number(value) };
}

export async function getPages(websiteId: string, opts?: { status?: string; limit?: number; offset?: number; includeDrafts?: boolean }): Promise<Page[]> {
  // Phase 6 — by default, hide drafts (is_draft=true) from regular listings.
  // Pass includeDrafts=true (or status='draft') to surface them.
  const includeDrafts = opts?.includeDrafts === true || opts?.status === "draft";
  const conds: any[] = [eq(pages.websiteId, websiteId)];
  if (opts?.status) conds.push(eq(pages.status, opts.status as any));
  if (!includeDrafts) conds.push(or(eq(pages.isDraft, false), sql`${pages.isDraft} IS NULL`));
  return db
    .select()
    .from(pages)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .orderBy(desc(pages.updatedAt))
    .limit(opts?.limit || 100)
    .offset(opts?.offset || 0);
}

export async function getPage(id: string): Promise<Page | undefined> {
  const [row] = await db.select().from(pages).where(eq(pages.id, id));
  return row;
}

export async function getPageBySlug(websiteId: string, slug: string): Promise<Page | undefined> {
  const [row] = await db.select().from(pages).where(and(eq(pages.websiteId, websiteId), eq(pages.slug, slug)));
  return row;
}

export async function getPageBySlugGlobal(slug: string): Promise<{ page: Page; website: Website } | undefined> {
  const [row] = await db
    .select({ page: pages, website: websites })
    .from(pages)
    .innerJoin(websites, eq(pages.websiteId, websites.id))
    .where(and(eq(pages.slug, slug), eq(pages.status, "published")))
    .limit(1);
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
  // internalLinks.fromPageId and toPageId have no cascade — delete links for this page first
  await db.delete(internalLinks).where(or(eq(internalLinks.fromPageId, id), eq(internalLinks.toPageId, id)));
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

export async function createPagesBatch(data: InsertPage[]): Promise<Page[]> {
  if (data.length === 0) return [];
  return db.insert(pages).values(data).onConflictDoNothing().returning();
}

export async function createPageVersionsBatch(data: InsertPageVersion[]): Promise<void> {
  if (data.length === 0) return;
  await db.insert(pageVersions).values(data);
}

export async function setActivePageVersion(pageId: string, versionId: string): Promise<void> {
  await db.update(pageVersions).set({ isActive: false }).where(eq(pageVersions.pageId, pageId));
  await db.update(pageVersions).set({ isActive: true }).where(eq(pageVersions.id, versionId));
}

export async function replacePageContent(websiteId: string, find: string, replace: string): Promise<number> {
  const result = await db.execute(sql`
    UPDATE page_versions
    SET content_html = REPLACE(content_html, ${find}, ${replace})
    WHERE page_id IN (
      SELECT id FROM pages WHERE website_id = ${websiteId}
    )
    AND content_html LIKE ${'%' + find + '%'}
  `);
  return (result as any).rowCount ?? 0;
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

export async function deleteGenerationJob(id: string): Promise<void> {
  await db.delete(generationJobs).where(eq(generationJobs.id, id));
}

export async function deleteCompletedJobs(): Promise<number> {
  const result = await db.delete(generationJobs)
    .where(
      or(
        eq(generationJobs.status, "completed" as any),
        eq(generationJobs.status, "cancelled" as any),
        eq(generationJobs.status, "failed" as any),
      )
    )
    .returning({ id: generationJobs.id });
  return result.length;
}

export async function deleteJobsByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.delete(generationJobs)
    .where(
      and(
        inArray(generationJobs.id, ids),
        or(
          eq(generationJobs.status, "completed" as any),
          eq(generationJobs.status, "cancelled" as any),
          eq(generationJobs.status, "failed" as any),
        )
      )
    )
    .returning({ id: generationJobs.id });
  return result.length;
}

// ─── Sitemaps ─────────────────────────────────────────────────────────────────

// Sort numerically by chunk number (sitemap-1, sitemap-2 ... sitemap-10, sitemap-11)
// rather than alphabetically (sitemap-1, sitemap-10, sitemap-11 ... sitemap-2).
const sitemapNumericOrder = sql`CAST(REGEXP_REPLACE(${sitemaps.slug}, '[^0-9]', '', 'g') AS INTEGER)`;

export async function getSitemaps(websiteId: string): Promise<Sitemap[]> {
  return db.select().from(sitemaps).where(eq(sitemaps.websiteId, websiteId)).orderBy(sitemapNumericOrder);
}

// Lightweight version — omits xmlContent so the response stays small even for sites with 28+ chunks
export async function getSitemapsMeta(websiteId: string) {
  return db.select({
    id: sitemaps.id,
    websiteId: sitemaps.websiteId,
    name: sitemaps.name,
    slug: sitemaps.slug,
    urlCount: sitemaps.urlCount,
    r2Key: sitemaps.r2Key,
    lastGenerated: sitemaps.lastGenerated,
    createdAt: sitemaps.createdAt,
    updatedAt: sitemaps.updatedAt,
  }).from(sitemaps).where(eq(sitemaps.websiteId, websiteId)).orderBy(sitemapNumericOrder);
}

// Fetch a single chunk's xmlContent by slug — avoids loading all N chunks for one row
export async function getSitemapBySlug(websiteId: string, slug: string): Promise<Sitemap | undefined> {
  const [row] = await db.select().from(sitemaps).where(and(eq(sitemaps.websiteId, websiteId), eq(sitemaps.slug, slug)));
  return row;
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

export async function updateSitemapXml(websiteId: string, slug: string, xmlContent: string): Promise<void> {
  await db.update(sitemaps)
    .set({ xmlContent, updatedAt: new Date() })
    .where(and(eq(sitemaps.websiteId, websiteId), eq(sitemaps.slug, slug)));
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
  // Use raw SQL to avoid Drizzle ORM camelCase→snake_case column mapping bugs
  // that cause published_pages and other columns to return 0 in compiled production builds.
  const { pool } = await import("./db");
  const [accountRes, websiteRes, jobRes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM accounts`),
    pool.query(`SELECT COALESCE(SUM(published_pages), 0)::int AS published_pages, COUNT(*)::int AS total FROM websites`),
    pool.query(`SELECT COUNT(*)::int AS count FROM generation_jobs WHERE status = 'running'`),
  ]);

  return {
    totalAccounts: Number(accountRes.rows[0]?.count ?? 0),
    totalWebsites: Number(websiteRes.rows[0]?.total ?? 0),
    publishedPages: Number(websiteRes.rows[0]?.published_pages ?? 0),
    draftPages: 0,
    reviewPages: 0,
    activeJobs: Number(jobRes.rows[0]?.count ?? 0),
  };
}

let _recentActivityCache: { data: { recentJobs: any[]; recentPages: any[] }; exp: number } | null = null;
const RECENT_ACTIVITY_TTL = 60_000; // 60 seconds

export async function getRecentActivity(limit = 20) {
  if (_recentActivityCache && Date.now() < _recentActivityCache.exp) {
    return _recentActivityCache.data;
  }
  const [recentJobs, recentPages] = await Promise.all([
    db.select().from(generationJobs).orderBy(desc(generationJobs.createdAt)).limit(limit),
    db.execute(sql`
      SELECT id, website_id AS "websiteId", slug, title, status, updated_at AS "updatedAt"
      FROM pages
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `),
  ]);
  const data = {
    recentJobs,
    recentPages: (recentPages as any).rows ?? [],
  };
  _recentActivityCache = { data, exp: Date.now() + RECENT_ACTIVITY_TTL };
  return data;
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

/**
 * UPSERT a variation bank row.
 *
 * Bug fix: the previous plain INSERT would throw a unique-constraint error when
 * a row already existed (e.g. one that was written with an empty variations
 * array). That error was silently swallowed by writeBankPayload's try/catch,
 * meaning the section remained empty and the UI health-check kept showing ❌.
 *
 * The ON CONFLICT clause targets the unique index on
 * (website_id, service, section_name) and overwrites variations so that any
 * previously empty row gets properly populated.
 */
export async function createVariationBank(data: InsertContentVariationBank): Promise<ContentVariationBank> {
  const [row] = await db
    .insert(contentVariationBanks)
    .values(data)
    .onConflictDoUpdate({
      target: [
        contentVariationBanks.websiteId,
        contentVariationBanks.service,
        contentVariationBanks.sectionName,
      ],
      set: {
        variations: sql`EXCLUDED.variations`,
      },
    })
    .returning();
  return row;
}

export async function deleteVariationBanks(websiteId: string, service: string): Promise<void> {
  await db.delete(contentVariationBanks)
    .where(and(eq(contentVariationBanks.websiteId, websiteId), eq(contentVariationBanks.service, service)));
}

// ─── State Data ───────────────────────────────────────────────────────────────

export async function getAllStateData(): Promise<Map<string, StateData>> {
  const rows = await db.select().from(stateData);
  return new Map(rows.map(r => [r.stateAbbr.toUpperCase(), r]));
}

export async function getPageSlugSet(websiteId: string): Promise<Set<string>> {
  const rows = await db.select({ slug: pages.slug }).from(pages).where(eq(pages.websiteId, websiteId));
  return new Set(rows.map(r => r.slug));
}

export async function getStaleRunningJobs(): Promise<typeof generationJobs.$inferSelect[]> {
  return db.select().from(generationJobs).where(
    or(eq(generationJobs.status, "running"), eq(generationJobs.status, "pending"))
  );
}

// State data is a static reference table (~50 rows, never changes at runtime) — cache permanently
const stateDataByAbbrCache = new Map<string, StateData | undefined>();
const stateDataByNameCache = new Map<string, StateData | undefined>();

export async function getStateDataByAbbr(abbr: string): Promise<StateData | undefined> {
  const key = abbr.toUpperCase();
  if (stateDataByAbbrCache.has(key)) return stateDataByAbbrCache.get(key);
  const [row] = await db.select().from(stateData).where(eq(stateData.stateAbbr, key));
  stateDataByAbbrCache.set(key, row);
  if (row) stateDataByNameCache.set(row.stateName.toLowerCase(), row);
  return row;
}

export async function getStateDataByName(name: string): Promise<StateData | undefined> {
  const key = name.toLowerCase();
  if (stateDataByNameCache.has(key)) return stateDataByNameCache.get(key);
  const [row] = await db.select().from(stateData).where(ilike(stateData.stateName, name));
  stateDataByNameCache.set(key, row);
  if (row) stateDataByAbbrCache.set(row.stateAbbr.toUpperCase(), row);
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

// ─── Page Navigation (states/cities footer grid) ─────────────────────────────

// 5-minute caches for nav data — called on every public page render (crawler traffic)
const stateNavPagesCache = new Map<string, { data: {displayName: string, slug: string}[]; exp: number }>();
const cityPagesCache = new Map<string, { data: {displayName: string, slug: string}[]; exp: number }>();
const NAV_CACHE_TTL = 5 * 60_000;

// Sibling service pages cache — uncached LIKE query, 5-min TTL, key = websiteId:locationSuffix
const siblingServiceCache = new Map<string, { data: {title: string, slug: string, serviceName: string | null}[]; exp: number }>();

// Outbound links cache — queried on every page render, 10-min TTL (matches HTML cache TTL), key = pageId
const outboundLinksCache = new Map<string, { data: {slug: string; anchorText: string; linkType: string}[]; exp: number }>();
const OUTBOUND_LINKS_CACHE_TTL = 10 * 60_000;

// Brand profiles cache — queried on every page render, 5-min TTL, key = accountId
const brandProfilesCache = new Map<string, { data: BrandProfile[]; exp: number }>();

export async function getStateNavPages(websiteId: string, serviceSlug?: string): Promise<{displayName: string, slug: string}[]> {
  const cacheKey = `${websiteId}:${serviceSlug ?? ""}`;
  const cached = stateNavPagesCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return cached.data;

  const [hubPages, states] = await Promise.all([
    db.select({ title: pages.title, slug: pages.slug })
      .from(pages)
      .where(and(eq(pages.websiteId, websiteId), eq(pages.status, "published"), eq(pages.pageType, "state_hub")))
      .orderBy(asc(pages.title)),
    db.select({ stateName: stateData.stateName, stateAbbr: stateData.stateAbbr })
      .from(stateData)
      .orderBy(asc(stateData.stateName)),
  ]);

  // When a serviceSlug is provided, prefer pages whose slug starts with that service prefix
  // so the "Explore All Locations" nav links stay on the same service
  const servicePrefix = serviceSlug ? serviceSlug + "-" : null;

  const seen = new Set<string>();
  const result: {displayName: string, slug: string}[] = [];
  for (const state of states) {
    // First pass: try to find a state hub page for the same service
    if (servicePrefix) {
      for (const p of hubPages) {
        if (!seen.has(state.stateName) && p.slug.startsWith(servicePrefix) && p.title.toLowerCase().includes(state.stateName.toLowerCase())) {
          seen.add(state.stateName);
          result.push({ displayName: state.stateName, slug: p.slug });
          break;
        }
      }
    }
    // Second pass: fall back to any state hub page for this state
    if (!seen.has(state.stateName)) {
      for (const p of hubPages) {
        if (!seen.has(state.stateName) && p.title.toLowerCase().includes(`in ${state.stateName.toLowerCase()}`)) {
          seen.add(state.stateName);
          result.push({ displayName: state.stateName, slug: p.slug });
          break;
        }
      }
    }
  }
  stateNavPagesCache.set(cacheKey, { data: result, exp: Date.now() + NAV_CACHE_TTL });
  return result;
}

export async function getSiblingServicePages(websiteId: string, currentSlug: string, currentPageId: string, locationId?: string | null): Promise<{title: string, slug: string, serviceName: string | null}[]> {
  // Use locationId when available — hits idx_pages_website_loc_pub (fast index).
  // Fall back to slug suffix LIKE only when locationId is absent (older pages).
  if (locationId) {
    const cacheKey = `${websiteId}:loc:${locationId}`;
    const cached = siblingServiceCache.get(cacheKey);
    if (cached && Date.now() < cached.exp) {
      return cached.data.filter(r => r.slug !== currentSlug);
    }
    const rows = await db.select({ title: pages.title, slug: pages.slug, serviceName: services.name })
      .from(pages)
      .leftJoin(services, eq(pages.serviceId, services.id))
      .where(and(
        eq(pages.websiteId, websiteId),
        eq(pages.status, "published"),
        eq(pages.locationId, locationId),
      ))
      .orderBy(asc(services.name), asc(pages.title))
      .limit(21);
    const result = rows.map(r => ({ title: r.title, slug: r.slug, serviceName: r.serviceName ?? null }));
    siblingServiceCache.set(cacheKey, { data: result, exp: Date.now() + NAV_CACHE_TTL });
    return result.filter(r => r.slug !== currentSlug);
  }

  const inIdx = currentSlug.lastIndexOf("-in-");
  if (inIdx === -1) return [];
  const locationSuffix = currentSlug.slice(inIdx); // e.g. "-in-dallas-tx"

  const cacheKey = `${websiteId}:${locationSuffix}`;
  const cached = siblingServiceCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) {
    return cached.data.filter(r => r.slug !== currentSlug);
  }

  const rows = await db.select({ title: pages.title, slug: pages.slug, serviceName: services.name })
    .from(pages)
    .leftJoin(services, eq(pages.serviceId, services.id))
    .where(and(
      eq(pages.websiteId, websiteId),
      eq(pages.status, "published"),
      sql`${pages.slug} LIKE ${"%" + locationSuffix}`,
    ))
    .orderBy(asc(services.name), asc(pages.title))
    .limit(21);
  const result = rows.map(r => ({ title: r.title, slug: r.slug, serviceName: r.serviceName ?? null }));
  siblingServiceCache.set(cacheKey, { data: result, exp: Date.now() + NAV_CACHE_TTL });
  return result.filter(r => r.slug !== currentSlug);
}

export async function getCityPagesForState(websiteId: string, stateCode: string): Promise<{displayName: string, slug: string}[]> {
  const cacheKey = `${websiteId}:${stateCode}`;
  const cached = cityPagesCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return cached.data;

  const rows = await db.select({ title: pages.title, slug: pages.slug })
    .from(pages)
    .innerJoin(locations, eq(pages.locationId, locations.id))
    .where(and(
      eq(pages.websiteId, websiteId),
      eq(pages.status, "published"),
      eq(locations.stateCode, stateCode),
      sql`${pages.pageType} != 'state_hub'`,
    ))
    .orderBy(asc(pages.title));
  const result = rows.map(r => {
    const afterIn = r.title.match(/\bin\s+(.+?)(?:,|\s*\|)/i);
    return { displayName: afterIn ? afterIn[1].trim() : r.title, slug: r.slug };
  });
  cityPagesCache.set(cacheKey, { data: result, exp: Date.now() + NAV_CACHE_TTL });
  return result;
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function findRecentLeadByEmail(websiteId: string, email: string, withinMs = 86_400_000): Promise<Lead | undefined> {
  const since = new Date(Date.now() - withinMs);
  const [row] = await db.select().from(leads)
    .where(and(eq(leads.websiteId, websiteId), eq(leads.email, email), gte(leads.createdAt, since)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return row;
}

export async function createLead(data: InsertLead): Promise<Lead> {
  const [row] = await db.insert(leads).values(data).returning();
  return row;
}

export async function getLeads(websiteId: string, limit = 50, offset = 0): Promise<Lead[]> {
  return db.select().from(leads)
    .where(eq(leads.websiteId, websiteId))
    .orderBy(desc(leads.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getLeadCount(websiteId: string): Promise<number> {
  const [{ c }] = await db.select({ c: count() }).from(leads).where(eq(leads.websiteId, websiteId));
  return Number(c);
}

export async function getAllLeads(limit = 100, offset = 0): Promise<Lead[]> {
  return db.select().from(leads).orderBy(desc(leads.createdAt)).limit(limit).offset(offset);
}

// ─── Tier & Score Management ──────────────────────────────────────────────────

export async function updatePageEEATScores(
  pageId: string,
  scores: { trustScore: number; evidenceScore: number; contentQualityScore: number },
): Promise<void> {
  await db.update(pages).set({
    trustScore: scores.trustScore,
    evidenceScore: scores.evidenceScore,
    contentQualityScore: scores.contentQualityScore,
    updatedAt: new Date(),
  } as any).where(eq(pages.id, pageId));
}

export async function updatePageScore(
  pageId: string,
  qualityScore: number,
  scoreBreakdown: Record<string, unknown>,
  tier?: number,
): Promise<void> {
  const update: Record<string, unknown> = {
    qualityScore,
    scoreBreakdown,
    lastEvaluatedAt: new Date(),
    updatedAt: new Date(),
  };
  if (tier !== undefined) update.tier = tier;
  await db.update(pages).set(update as any).where(eq(pages.id, pageId));
}

export async function updatePageTier(pageId: string, tier: number): Promise<void> {
  await db.update(pages).set({ tier, updatedAt: new Date() } as any).where(eq(pages.id, pageId));
}

export async function getTierDistribution(websiteId: string): Promise<{
  tier1: number; tier2: number; tier3: number;
  unscored: number; total: number;
  avgScore: number | null;
}> {
  const rows = await db
    .select({
      tier: pages.tier,
      qualityScore: pages.qualityScore,
    })
    .from(pages)
    .where(and(eq(pages.websiteId, websiteId), eq(pages.status, "published")));

  let tier1 = 0, tier2 = 0, tier3 = 0, unscored = 0;
  let scoreSum = 0, scoreCount = 0;

  for (const r of rows) {
    if (r.qualityScore === null || r.qualityScore === undefined) {
      unscored++;
    } else {
      scoreSum += r.qualityScore;
      scoreCount++;
    }
    const t = (r as any).tier ?? 2;
    if (t === 1) tier1++;
    else if (t === 3) tier3++;
    else tier2++;
  }

  return {
    tier1, tier2, tier3, unscored,
    total: rows.length,
    avgScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
  };
}

export async function getPagesByTier(websiteId: string, tier: number, limit: number, offset: number): Promise<Page[]> {
  return db.select().from(pages)
    .where(and(eq(pages.websiteId, websiteId), eq(pages.status, "published"), eq(pages.tier as any, tier)))
    .orderBy(desc(pages.updatedAt))
    .limit(limit)
    .offset(offset);
}

export async function getUnscoredPages(websiteId: string, limit = 500): Promise<Array<{id: string; wordCount: number | null; metaDescription: string | null; title: string; tier: number; serviceId: string | null; locationId: string | null}>> {
  return db
    .select({ id: pages.id, wordCount: pages.wordCount, metaDescription: pages.metaDescription, title: pages.title, tier: pages.tier as any, serviceId: pages.serviceId as any, locationId: pages.locationId as any })
    .from(pages)
    .where(and(eq(pages.websiteId, websiteId), eq(pages.status, "published"), isNull(pages.qualityScore)))
    .limit(limit) as any;
}

export async function getUnEEATScoredPages(websiteId: string, limit = 200): Promise<Array<{id: string; wordCount: number | null; metaDescription: string | null; title: string; tier: number; serviceId: string | null; locationId: string | null}>> {
  return db
    .select({ id: pages.id, wordCount: pages.wordCount, metaDescription: pages.metaDescription, title: pages.title, tier: pages.tier as any, serviceId: pages.serviceId as any, locationId: pages.locationId as any })
    .from(pages)
    .where(and(
      eq(pages.websiteId, websiteId),
      eq(pages.status, "published" as any),
      sql`${pages.qualityScore} IS NOT NULL`,
      sql`trust_score IS NULL`,
    ))
    .limit(limit) as any;
}

export async function countUnscoredPages(websiteId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(pages)
    .where(and(eq(pages.websiteId, websiteId), eq(pages.status, "published"), isNull(pages.qualityScore)));
  return row?.count ?? 0;
}

export interface BulkTierFilters {
  serviceId?: string;
  locationId?: string;
  locationName?: string;
  blueprintId?: string;
  scoreMin?: number;
  scoreMax?: number;
}

function applyBulkTierConditions(conditions: any[], filters: BulkTierFilters) {
  if (filters.serviceId) conditions.push(eq(pages.serviceId as any, filters.serviceId));
  if (filters.locationId) conditions.push(eq(pages.locationId as any, filters.locationId));
  if (filters.locationName) {
    conditions.push(sql`${pages.locationId} IN (SELECT id FROM locations WHERE LOWER(name) LIKE LOWER(${'%' + filters.locationName + '%'}))`);
  }
  if (filters.blueprintId) conditions.push(eq(pages.blueprintId as any, filters.blueprintId));
  if (filters.scoreMin !== undefined) conditions.push(sql`${pages.qualityScore} >= ${filters.scoreMin}`);
  if (filters.scoreMax !== undefined) conditions.push(sql`${pages.qualityScore} <= ${filters.scoreMax}`);
}

export async function bulkFilterPagesCount(websiteId: string, filters: BulkTierFilters): Promise<{ count: number; sample: Array<{ title: string; slug: string; tier: number; qualityScore: number | null }> }> {
  const conditions = [eq(pages.websiteId, websiteId), eq(pages.status, "published" as any)];
  applyBulkTierConditions(conditions, filters);
  const [{ n }] = await db.select({ n: count() }).from(pages).where(and(...conditions));
  const sample = await db.select({ title: pages.title, slug: pages.slug, tier: pages.tier as any, qualityScore: pages.qualityScore }).from(pages).where(and(...conditions)).orderBy(desc(pages.qualityScore)).limit(5) as any[];
  return { count: Number(n), sample };
}

export async function bulkSetPageTier(websiteId: string, tier: number, filters: BulkTierFilters): Promise<{ affected: number; slugs: string[] }> {
  const conditions = [eq(pages.websiteId, websiteId), eq(pages.status, "published" as any)];
  applyBulkTierConditions(conditions, filters);
  const whereClause = and(...conditions);
  const ids = await db.select({ id: pages.id, slug: pages.slug }).from(pages).where(whereClause);
  if (ids.length === 0) return { affected: 0, slugs: [] };
  await db.update(pages).set({ tier: tier as any, updatedAt: new Date() }).where(inArray(pages.id, ids.map(r => r.id)));
  return { affected: ids.length, slugs: ids.map(r => r.slug) };
}

export async function bulkUpdatePageTiers(websiteId: string, tierThreshold: number): Promise<{ promoted: number; promotedSlugs: string[] }> {
  // Batched UPDATE — processes BATCH_SIZE rows per round-trip so we never hold a
  // table-spanning row lock for minutes on multi-million-row sites.
  // Uses partial index idx_pages_pub_tier (WHERE status='published') for speed.
  const BATCH_SIZE = 10_000;
  let totalPromoted = 0;
  const allSlugs: string[] = [];
  while (true) {
    const result = await db.execute(sql`
      WITH candidates AS (
        SELECT id FROM pages
        WHERE website_id = ${websiteId}
          AND status = 'published'
          AND tier != 1
          AND (
            (trust_score IS NOT NULL AND evidence_score IS NOT NULL AND content_quality_score IS NOT NULL
             AND trust_score >= 75 AND evidence_score >= 70 AND content_quality_score >= 65)
            OR
            (trust_score IS NULL AND quality_score IS NOT NULL AND quality_score >= ${tierThreshold})
          )
        LIMIT ${BATCH_SIZE}
      )
      UPDATE pages
      SET tier = 1, updated_at = NOW()
      WHERE id IN (SELECT id FROM candidates)
      RETURNING slug
    `);
    const rows = (result as any).rows ?? [];
    const batchCount = (result as any).rowCount ?? 0;
    if (batchCount === 0) break;
    totalPromoted += batchCount;
    allSlugs.push(...rows.map((r: any) => r.slug));
    if (batchCount < BATCH_SIZE) break; // last batch
    // Brief yield between batches to let other queries breathe
    await new Promise(r => setTimeout(r, 50));
  }
  return { promoted: totalPromoted, promotedSlugs: allSlugs };
}

export async function bulkSetTier3(websiteId: string, scoreThreshold: number): Promise<{ demoted: number }> {
  // Dual-gate: E-E-A-T gate for pages with new scores; legacy qualityScore gate for the rest.
  const result = await db.execute(sql`
    UPDATE pages
    SET tier = 3, updated_at = NOW()
    WHERE website_id = ${websiteId}
      AND status = 'published'
      AND tier != 3
      AND (
        -- E-E-A-T path: new scores present but fail Tier 2 thresholds
        (trust_score IS NOT NULL AND evidence_score IS NOT NULL AND content_quality_score IS NOT NULL
         AND (trust_score < 55 OR evidence_score < 50 OR content_quality_score < 50))
        OR
        -- Legacy path: no new scores, use qualityScore gate
        (trust_score IS NULL AND quality_score IS NOT NULL AND quality_score < ${scoreThreshold})
      )
    RETURNING id
  `);
  return { demoted: (result as any).rowCount ?? 0 };
}

// ─── Fallback Hit Logs ────────────────────────────────────────────────────────

export async function logFallbackHit(websiteId: string, slug: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO fallback_hit_logs (id, website_id, slug, hit_count, first_seen_at, last_seen_at, promoted, promoted_at)
    VALUES (gen_random_uuid(), ${websiteId}, ${slug}, 1, NOW(), NOW(), false, NULL)
    ON CONFLICT (website_id, slug)
    DO UPDATE SET hit_count = fallback_hit_logs.hit_count + 1, last_seen_at = NOW()
  `);
}

export async function getFallbackHits(websiteId: string, limit = 50): Promise<FallbackHitLog[]> {
  return db.select().from(fallbackHitLogs)
    .where(eq(fallbackHitLogs.websiteId, websiteId))
    .orderBy(desc(fallbackHitLogs.hitCount))
    .limit(limit) as any;
}

export async function getFallbackHit(websiteId: string, slug: string): Promise<FallbackHitLog | undefined> {
  const [row] = await db.select().from(fallbackHitLogs)
    .where(and(eq(fallbackHitLogs.websiteId, websiteId), eq(fallbackHitLogs.slug, slug)));
  return row as any;
}

export async function promoteFallbackSlug(websiteId: string, slug: string): Promise<void> {
  await db.update(fallbackHitLogs)
    .set({ promoted: true, promotedAt: new Date() })
    .where(and(eq(fallbackHitLogs.websiteId, websiteId), eq(fallbackHitLogs.slug, slug)));
}

// ─── Variation Bank Completeness ──────────────────────────────────────────────

export async function upsertBankCompleteness(data: InsertVariationBankCompleteness): Promise<void> {
  await db.execute(sql`
    INSERT INTO variation_bank_completeness
      (id, website_id, service,
       has_intro, has_how_it_works, has_benefits, has_faq, has_cta,
       has_local_context, has_use_case, has_proof_trust, has_pain_point, has_local_stat,
       total_variations, avg_variations_per_section, completeness_score, is_eligible_for_tier1, last_computed_at)
    VALUES
      (gen_random_uuid(), ${data.websiteId}, ${data.service},
       ${data.hasIntro}, ${data.hasHowItWorks}, ${data.hasBenefits}, ${data.hasFaq}, ${data.hasCta},
       ${(data as any).hasLocalContext ?? false}, ${(data as any).hasUseCase ?? false},
       ${(data as any).hasProofTrust ?? false}, ${(data as any).hasPainPoint ?? false},
       ${(data as any).hasLocalStat ?? false},
       ${data.totalVariations}, ${data.avgVariationsPerSection},
       ${data.completenessScore}, ${data.isEligibleForTier1}, NOW())
    ON CONFLICT (website_id, service)
    DO UPDATE SET
      has_intro = EXCLUDED.has_intro,
      has_how_it_works = EXCLUDED.has_how_it_works,
      has_benefits = EXCLUDED.has_benefits,
      has_faq = EXCLUDED.has_faq,
      has_cta = EXCLUDED.has_cta,
      has_local_context = EXCLUDED.has_local_context,
      has_use_case = EXCLUDED.has_use_case,
      has_proof_trust = EXCLUDED.has_proof_trust,
      has_pain_point = EXCLUDED.has_pain_point,
      has_local_stat = EXCLUDED.has_local_stat,
      total_variations = EXCLUDED.total_variations,
      avg_variations_per_section = EXCLUDED.avg_variations_per_section,
      completeness_score = EXCLUDED.completeness_score,
      is_eligible_for_tier1 = EXCLUDED.is_eligible_for_tier1,
      last_computed_at = NOW()
  `);
}

export async function getBankCompleteness(websiteId: string): Promise<VariationBankCompleteness[]> {
  return db.select().from(variationBankCompleteness)
    .where(eq(variationBankCompleteness.websiteId, websiteId))
    .orderBy(asc(variationBankCompleteness.service)) as any;
}

export async function getScoreDistribution(websiteId: string): Promise<Array<{ bucket: string; count: number }>> {
  const result = await db.execute(sql`
    SELECT
      CASE
        WHEN quality_score IS NULL THEN 'unscored'
        WHEN quality_score >= 90 THEN '90-100'
        WHEN quality_score >= 80 THEN '80-89'
        WHEN quality_score >= 70 THEN '70-79'
        WHEN quality_score >= 60 THEN '60-69'
        WHEN quality_score >= 50 THEN '50-59'
        WHEN quality_score >= 40 THEN '40-49'
        ELSE '0-39'
      END as bucket,
      COUNT(*)::int as count
    FROM pages
    WHERE website_id = ${websiteId} AND status = 'published'
    GROUP BY bucket
    ORDER BY bucket
  `);
  return (result as any).rows ?? [];
}

// ─── P8: Top Services / States by Tier ───────────────────────────────────────

export async function getTopServicesByTier1(websiteId: string, limit = 10): Promise<Array<{ name: string; count: number }>> {
  const rows = await db.execute(sql`
    SELECT s.name, COUNT(*)::int AS count
    FROM pages p
    JOIN services s ON p.service_id = s.id
    WHERE p.website_id = ${websiteId} AND p.tier = 1 AND p.status = 'published'
    GROUP BY s.name ORDER BY count DESC LIMIT ${limit}
  `);
  return (rows as any).rows ?? [];
}

export async function getTopStatesByTier1(websiteId: string, limit = 10): Promise<Array<{ stateCode: string; count: number }>> {
  const rows = await db.execute(sql`
    SELECT l.state_code AS "stateCode", COUNT(*)::int AS count
    FROM pages p
    JOIN locations l ON p.location_id = l.id
    WHERE p.website_id = ${websiteId} AND p.tier = 1 AND p.status = 'published'
    GROUP BY l.state_code ORDER BY count DESC LIMIT ${limit}
  `);
  return (rows as any).rows ?? [];
}

export async function getThinBankWarnings(websiteId: string, threshold = 60): Promise<Array<{ service: string; completenessScore: number; isEligibleForTier1: boolean; avgVariationsPerSection: number }>> {
  const rows = await db.execute(sql`
    SELECT service, completeness_score AS "completenessScore",
           is_eligible_for_tier1 AS "isEligibleForTier1",
           avg_variations_per_section AS "avgVariationsPerSection"
    FROM variation_bank_completeness
    WHERE website_id = ${websiteId} AND completeness_score < ${threshold}
    ORDER BY completeness_score ASC LIMIT 20
  `);
  return (rows as any).rows ?? [];
}

// ─── P6: Score + Apply Tiers in One Shot ──────────────────────────────────────

export async function getRecentlyScoredPages(websiteId: string, limit = 50): Promise<Array<{ id: string; title: string; slug: string; qualityScore: number | null; tier: number; updatedAt: Date }>> {
  return db.select({
    id: pages.id, title: pages.title, slug: pages.slug,
    qualityScore: pages.qualityScore, tier: pages.tier, updatedAt: pages.updatedAt,
  })
    .from(pages)
    .where(and(eq(pages.websiteId, websiteId), eq(pages.status, "published"), sql`${pages.qualityScore} IS NOT NULL`))
    .orderBy(desc(pages.updatedAt))
    .limit(limit);
}

// ─── P7: Internal Links ────────────────────────────────────────────────────────

export async function getInternalLinkStats(websiteId: string): Promise<{
  totalLinks: number; pagesWithLinks: number; totalPublished: number;
  topLinkedPages: Array<{ title: string; slug: string; inboundCount: number }>;
}> {
  // Use pre-computed publishedPages from websites table (maintained by DB trigger)
  // instead of COUNT(*) FROM pages — avoids full table scan on millions of rows.
  const [totalRes, withLinksRes, websiteRes] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS count FROM internal_links WHERE website_id = ${websiteId}`),
    db.execute(sql`SELECT COUNT(DISTINCT from_page_id)::int AS count FROM internal_links WHERE website_id = ${websiteId}`),
    db.execute(sql`SELECT published_pages FROM websites WHERE id = ${websiteId}`),
  ]);
  const topRes = await db.execute(sql`
    SELECT p.title, p.slug, COUNT(*)::int AS "inboundCount"
    FROM internal_links il JOIN pages p ON il.to_page_id = p.id
    WHERE il.website_id = ${websiteId}
    GROUP BY p.id, p.title, p.slug ORDER BY "inboundCount" DESC LIMIT 10
  `);
  return {
    totalLinks: (totalRes as any).rows?.[0]?.count ?? 0,
    pagesWithLinks: (withLinksRes as any).rows?.[0]?.count ?? 0,
    totalPublished: (websiteRes as any).rows?.[0]?.published_pages ?? 0,
    topLinkedPages: (topRes as any).rows ?? [],
  };
}

export async function clearInternalLinks(websiteId: string): Promise<void> {
  await db.delete(internalLinks).where(eq(internalLinks.websiteId, websiteId));
}

export async function saveInternalLinks(
  links: Array<{ websiteId: string; fromPageId: string; toPageId: string; anchorText: string; linkType: string }>
): Promise<number> {
  if (links.length === 0) return 0;
  const CHUNK = 200;
  let saved = 0;
  for (let i = 0; i < links.length; i += CHUNK) {
    const batch = links.slice(i, i + CHUNK);
    await db.insert(internalLinks).values(batch as any).onConflictDoNothing();
    saved += batch.length;
  }
  return saved;
}

export async function getOutboundLinksForPage(pageId: string): Promise<Array<{
  slug: string; anchorText: string; linkType: string;
}>> {
  const cached = outboundLinksCache.get(pageId);
  if (cached && Date.now() < cached.exp) return cached.data;

  const rows = await db.execute(sql`
    SELECT p.slug, il.anchor_text AS "anchorText", il.link_type AS "linkType"
    FROM internal_links il
    JOIN pages p ON il.to_page_id = p.id
    WHERE il.from_page_id = ${pageId}
      AND p.status = 'published'
    ORDER BY il.link_type
  `);
  const data = (rows as any).rows ?? [];
  outboundLinksCache.set(pageId, { data, exp: Date.now() + OUTBOUND_LINKS_CACHE_TTL });
  return data;
}

export function invalidateOutboundLinksCache(pageId: string) {
  outboundLinksCache.delete(pageId);
}

export function clearAllOutboundLinksCache(): void {
  outboundLinksCache.clear();
}

// Get all published pages for a website for internal link building
export async function getPagesForLinking(websiteId: string, limit = 5000): Promise<Array<{
  id: string; title: string; slug: string; pageType: string | null;
  serviceId: string | null; locationId: string | null;
}>> {
  return db.select({
    id: pages.id, title: pages.title, slug: pages.slug, pageType: pages.pageType,
    serviceId: pages.serviceId, locationId: pages.locationId,
  })
    .from(pages)
    .where(and(eq(pages.websiteId, websiteId), eq(pages.status, "published")))
    .limit(limit);
}

// ─── Hub Pages ────────────────────────────────────────────────────────────────

export async function getHubPages(websiteId: string): Promise<HubPage[]> {
  return db.select()
    .from(hubPages)
    .where(eq(hubPages.websiteId, websiteId))
    .orderBy(asc(hubPages.hubType), asc(hubPages.name));
}

export async function getHubPage(id: string): Promise<HubPage | undefined> {
  const [row] = await db.select().from(hubPages).where(eq(hubPages.id, id));
  return row;
}

export async function getHubPageBySlug(websiteId: string, slug: string): Promise<HubPage | undefined> {
  // Raw SQL to avoid Drizzle ORM camelCase→snake_case bug with website_id column in production
  const { pool } = await import("./db");
  const res = await pool.query(
    `SELECT * FROM hub_pages WHERE website_id = $1 AND slug = $2 LIMIT 1`,
    [websiteId, slug]
  );
  if (!res.rows[0]) return undefined;
  const r = res.rows[0];
  return {
    id: r.id,
    websiteId: r.website_id,
    accountId: r.account_id,
    hubType: r.hub_type,
    name: r.name,
    slug: r.slug,
    parentSlug: r.parent_slug,
    status: r.status,
    content: r.content,
    metaDescription: r.meta_description,
    maxChildLinks: r.max_child_links,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as HubPage;
}

export async function createHubPage(data: InsertHubPage): Promise<HubPage> {
  const [row] = await db.insert(hubPages).values(data).returning();
  return row;
}

export async function updateHubPage(id: string, data: Partial<InsertHubPage>): Promise<HubPage | undefined> {
  const [row] = await db.update(hubPages)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(hubPages.id, id))
    .returning();
  return row;
}

export async function deleteHubPage(id: string): Promise<void> {
  await db.delete(hubPages).where(eq(hubPages.id, id));
}

export async function bulkPublishHubDrafts(websiteId: string, hubType?: string): Promise<number> {
  const conditions: any[] = [eq(hubPages.websiteId, websiteId), eq(hubPages.status, "draft" as any)];
  if (hubType) conditions.push(eq(hubPages.hubType, hubType as any));
  const result = await db.update(hubPages).set({ status: "published" as any }).where(and(...conditions)).returning({ id: hubPages.id });
  return result.length;
}

/**
 * Get the top N child pages for a hub, ordered by quality_score DESC.
 * - service hub → pages whose title/slug match the service keyword
 * - state hub   → pages whose slug contains the state keyword
 * - city hub    → pages whose slug contains the city keyword
 */
export async function getChildPagesForHub(
  websiteId: string,
  hubType: string,
  keyword: string,
  limit: number,
): Promise<Array<{ title: string; slug: string; qualityScore: number | null; tier: number | null }>> {
  const kw = keyword.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
  // Build a LIKE pattern that matches the keyword anywhere in the slug
  const pattern = `%${kw}%`;
  const rows = await db
    .select({ title: pages.title, slug: pages.slug, qualityScore: pages.qualityScore, tier: pages.tier })
    .from(pages)
    .where(
      and(
        eq(pages.websiteId, websiteId),
        eq(pages.status, "published"),
        sql`lower(${pages.slug}) LIKE ${pattern}`,
      ),
    )
    .orderBy(desc(pages.qualityScore))
    .limit(limit);
  return rows;
}

// ─── Admin Notifications (Auto 5, 6, 7) ──────────────────────────────────────

export async function createAdminNotification(data: Omit<InsertAdminNotification, "readAt">): Promise<AdminNotification> {
  const [row] = await db.insert(adminNotifications).values({ ...data, readAt: null } as any).returning();
  return row;
}

export async function getAdminNotifications(websiteId: string, limit = 50, unreadOnly = false): Promise<AdminNotification[]> {
  const conditions = [eq(adminNotifications.websiteId, websiteId)];
  if (unreadOnly) conditions.push(isNull(adminNotifications.readAt));
  return db.select().from(adminNotifications).where(and(...conditions)).orderBy(desc(adminNotifications.createdAt)).limit(limit);
}

export async function markNotificationRead(id: string): Promise<void> {
  await db.update(adminNotifications).set({ readAt: new Date() } as any).where(eq(adminNotifications.id, id));
}

export async function getNotificationByMeta(websiteId: string, type: string, key: string): Promise<AdminNotification | undefined> {
  const [row] = await db.select().from(adminNotifications)
    .where(and(
      eq(adminNotifications.websiteId, websiteId),
      eq(adminNotifications.type, type),
      sql`metadata->>'slug' = ${key} OR metadata->>'service' = ${key}`,
    ))
    .limit(1);
  return row;
}

export async function getUnreadNotificationCount(websiteId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(adminNotifications)
    .where(and(eq(adminNotifications.websiteId, websiteId), isNull(adminNotifications.readAt)));
  return row?.n ?? 0;
}

// ─── Demotion Logs ────────────────────────────────────────────────────────────

export async function createDemotionLog(data: InsertDemotionLog): Promise<DemotionLog> {
  const [row] = await db.insert(demotionLogs).values(data).returning();
  return row;
}

export async function getDemotionLogs(websiteId: string, limit = 50): Promise<DemotionLog[]> {
  return db.select().from(demotionLogs)
    .where(eq(demotionLogs.websiteId, websiteId))
    .orderBy(desc(demotionLogs.createdAt))
    .limit(limit);
}

export async function getPromotionQueue(websiteId: string, limit = 50): Promise<FallbackHitLog[]> {
  return db.select().from(fallbackHitLogs)
    .where(and(
      eq(fallbackHitLogs.websiteId, websiteId),
      eq(fallbackHitLogs.promoted, false),
    ))
    .orderBy(desc(fallbackHitLogs.hitCount))
    .limit(limit) as any;
}

export async function markFallbackPromoted(logId: string): Promise<void> {
  await db.update(fallbackHitLogs)
    .set({ promoted: true, promotedAt: new Date() })
    .where(eq(fallbackHitLogs.id, logId));
}

// ─── Weekly Summary Stats ─────────────────────────────────────────────────────

export async function getWeeklySummaryStats(websiteId: string): Promise<{
  totalPublished: number;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  avgScore: number | null;
  newPagesThisWeek: number;
  fallbackHitsThisWeek: number;
}> {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [tierRes, newPagesRes, fallbackRes] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published')::int AS total_published,
        COUNT(*) FILTER (WHERE status = 'published' AND tier = 1)::int AS tier1,
        COUNT(*) FILTER (WHERE status = 'published' AND (tier = 2 OR tier IS NULL))::int AS tier2,
        COUNT(*) FILTER (WHERE status = 'published' AND tier = 3)::int AS tier3,
        ROUND(AVG(quality_score) FILTER (WHERE status = 'published' AND quality_score IS NOT NULL))::int AS avg_score
      FROM pages
      WHERE website_id = ${websiteId}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM pages
      WHERE website_id = ${websiteId}
        AND status = 'published'
        AND created_at >= ${oneWeekAgo}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM fallback_hit_logs
      WHERE website_id = ${websiteId}
        AND last_seen_at >= ${oneWeekAgo}
    `),
  ]);

  const t = (tierRes as any).rows?.[0] ?? {};
  return {
    totalPublished: t.total_published ?? 0,
    tier1Count: t.tier1 ?? 0,
    tier2Count: t.tier2 ?? 0,
    tier3Count: t.tier3 ?? 0,
    avgScore: t.avg_score ?? null,
    newPagesThisWeek: (newPagesRes as any).rows?.[0]?.count ?? 0,
    fallbackHitsThisWeek: (fallbackRes as any).rows?.[0]?.count ?? 0,
  };
}

// ─── Zero-Impression Tier 1 Pages ─────────────────────────────────────────────

export async function getZeroImpressionTier1Pages(
  websiteId: string,
  daysOld = 30,
  limit = 100,
): Promise<Array<{ id: string; title: string; slug: string; qualityScore: number | null; createdAt: Date }>> {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT p.id, p.title, p.slug, p.quality_score AS "qualityScore", p.created_at AS "createdAt"
    FROM pages p
    LEFT JOIN page_metrics pm ON pm.page_id = p.id
    WHERE p.website_id = ${websiteId}
      AND p.status = 'published'
      AND p.tier = 1
      AND p.created_at <= ${cutoff}
    GROUP BY p.id, p.title, p.slug, p.quality_score, p.created_at
    HAVING COALESCE(SUM(pm.impressions), 0) = 0
    ORDER BY p.created_at ASC
    LIMIT ${limit}
  `);
  return (rows as any).rows ?? [];
}
