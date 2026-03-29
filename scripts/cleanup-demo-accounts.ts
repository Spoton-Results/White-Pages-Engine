import { db } from "../server/db";
import {
  accounts, websites, brandProfiles, locations, services, industries,
  queryClusters, blueprints, pages, pageVersions, generationJobs,
  sitemaps, users
} from "../shared/schema";
import { inArray, eq, or } from "drizzle-orm";

async function cleanup() {
  const demoSlugs = ["acme-plumbing", "national-hvac"];
  const demoAccounts = await db.select().from(accounts).where(
    or(...demoSlugs.map(s => eq(accounts.slug, s)))
  );

  if (demoAccounts.length === 0) {
    console.log("No demo accounts found — already clean.");
    return;
  }

  const ids = demoAccounts.map(a => a.id);
  console.log(`Removing demo accounts: ${demoAccounts.map(a => a.name).join(", ")}`);

  // Delete in dependency order
  const demoWebsites = await db.select().from(websites).where(inArray(websites.accountId, ids));
  const websiteIds = demoWebsites.map(w => w.id);

  if (websiteIds.length > 0) {
    // Pages + versions
    const demoPages = await db.select().from(pages).where(inArray(pages.websiteId, websiteIds));
    const pageIds = demoPages.map(p => p.id);
    if (pageIds.length > 0) {
      await db.delete(pageVersions).where(inArray(pageVersions.pageId, pageIds));
      await db.delete(pages).where(inArray(pages.id, pageIds));
      console.log(`  Deleted ${pageIds.length} pages`);
    }
    // Sitemaps
    await db.delete(sitemaps).where(inArray(sitemaps.websiteId, websiteIds));
    // Generation jobs (must delete before blueprints due to FK)
    await db.delete(generationJobs).where(inArray(generationJobs.websiteId, websiteIds));
    // Blueprints
    await db.delete(blueprints).where(inArray(blueprints.websiteId, websiteIds));
    // Websites
    await db.delete(websites).where(inArray(websites.id, websiteIds));
    console.log(`  Deleted ${websiteIds.length} websites`);
  }

  // Any remaining jobs not tied to a website
  await db.delete(generationJobs).where(inArray(generationJobs.accountId, ids));
  // Query clusters must go before services (FK: query_clusters.serviceId → services.id)
  await db.delete(queryClusters).where(inArray(queryClusters.accountId, ids));
  // Services
  await db.delete(services).where(inArray(services.accountId, ids));
  // Locations
  await db.delete(locations).where(inArray(locations.accountId, ids));
  // Industries
  await db.delete(industries).where(inArray(industries.accountId, ids));
  // Brand profiles
  await db.delete(brandProfiles).where(inArray(brandProfiles.accountId, ids));
  // Users belonging to these accounts
  await db.delete(users).where(inArray(users.accountId, ids));
  // Finally accounts
  await db.delete(accounts).where(inArray(accounts.id, ids));

  console.log(`✅ Removed ${demoAccounts.length} demo accounts and all related data.`);
}

cleanup().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
