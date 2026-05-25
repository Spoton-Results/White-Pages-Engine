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
  // ✅ CHANGED: use raw SQL to avoid Drizzle ORM camelCase→snake_case bug in production
  // (same pattern used by getAgencyAccounts, getWebsites, getDashboardStats)
  const res = await pool.query(`SELECT * FROM agencies ORDER BY name ASC`);
  return res.rows.map((r: any) => ({
    ...r,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })) as Agency[];
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
  // ✅ CHANGED: use raw SQL to avoid Drizzle ORM camelCase→snake_case bug in production
  // (same pattern used by getAgencyAccounts, getWebsites, getDashboardStats)
  const res = await pool.query(`SELECT * FROM accounts ORDER BY created_at DESC`);
  return res.rows.map((r: any) => ({
    ...r,
    agencyId: r.agency_id,
    clientStatus: r.client_status,
    reportToken: r.report_token,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })) as Account[];
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
  // ✅ CHANGED: use raw SQL to avoid Drizzle ORM camelCase→snake_case bug in production
  const res = await pool.query(
    `SELECT * FROM brand_profiles WHERE account_id = $1 ORDER BY created_at DESC`,
    [accountId]
  );
  const data = res.rows.map((r: any) => ({
    ...r,
    accountId: r.account_id,
    websiteUrl: r.website_url,
    primaryColor: r.primary_color,
    secondaryColor: r.secondary_color,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })) as BrandProfile[];
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
  // ✅ CHANGED: use raw SQL to avoid Drizzle ORM camelCase→snake_case bug in production
  // account_id, city_tier, state_code all fail to map correctly in compiled production builds
  const params: any[] = [accountId];
  let query = `SELECT * FROM locations WHERE account_id = $1`;
  if (type) { params.push(type); query += ` AND type = $${params.length}`; }
  if (search) { params.push(`%${search}%`); query += ` AND name ILIKE $${params.length}`; }
  if (cityTier) { params.push(cityTier); query += ` AND city_tier = $${params.length}`; }
  if (orderBy === "population") {
    query += ` ORDER BY population DESC`;
  } else if (type) {
    query += ` ORDER BY name ASC`;
  } else {
    query += ` ORDER BY type ASC, name ASC`;
  }
  if (limit) { params.push(limit); query += ` LIMIT $${params.length}`; }
  if (offset) { params.push(offset); query += ` OFFSET $${params.length}`; }
  const res = await pool.query(query, params);
  return res.rows.map((r: any) => ({
    ...r,
    accountId: r.account_id,
    stateCode: r.state_code,
    cityTier: r.city_tier,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })) as Location[];
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

// ✅ CHANGED: added optional `force` flag.
//   Default (force=false): skip slugs already in the DB for this account (dedup behavior — unchanged).
//   force=true: delete all existing city-type locations for this account first, then insert everything fresh.
//   The `force` path is used exclusively by the load-standard route so re-running it
//   always results in a full fresh import instead of silently skipping everything.
// 🔒 UNTOUCHED: chunked insert logic, seenInPayload dedup, all callers that omit the flag.
export async function bulkCreateLocations(
  accountId: string,
  items: InsertLocation[],
  opts?: { force?: boolean },
): Promise<{ inserted: number }> {
  if (!items.length) return { inserted: 0 };

  if (opts?.force) {
    // Delete all city-type locations for this account so the fresh import replaces them.
    // State-type locations are intentionally left alone.
    await db.delete(locations).where(
      and(eq(locations.accountId, accountId), eq(locations.type, "city" as any))
    );
  }

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
  // ✅ CHANGED: use raw SQL to avoid Drizzle ORM camelCase→snake_case bug in production
  const res = await pool.query(
    `SELECT * FROM services WHERE account_id = $1 ORDER BY name ASC`,
    [accountId]
  );
  return res.rows.map((r: any) => ({
    ...r,
    accountId: r.account_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })) as Service[];
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
  // pages.serviceId and queryClusters.serviceId have no cascade — null out before