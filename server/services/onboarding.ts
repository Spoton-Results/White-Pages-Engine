import { db } from "../db";
import { eq } from "drizzle-orm";
import { onboardingSubmissions, websites as websitesTable } from "@shared/schema";
import * as storage from "../storage";
import { STANDARD_CITIES } from "../data/standardCities";

const STATE_ABBR_TO_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function markFailed(submissionId: string, note: string): Promise<void> {
  try {
    await db
      .update(onboardingSubmissions)
      .set({ status: "needs_info", onboardingNotes: note })
      .where(eq(onboardingSubmissions.id, submissionId));
  } catch (e: any) {
    console.error(`[onboarding-autocreate] failed to mark needs_info for ${submissionId}: ${e?.message}`);
  }
}

/**
 * Auto-creates a Nexus account from a submitted onboarding row.
 * Runs the 6 creation steps in order. On any failure, sets status='needs_info'
 * with a human-readable note. Partial creation is preserved on failure.
 *
 * Does NOT generate pages, blueprints, query clusters, variation banks,
 * or publish anything — those happen in later phases.
 */
export async function processOnboardingSubmission(submissionId: string): Promise<{
  success: boolean;
  accountId?: string;
  websiteId?: string;
  brandProfileId?: string;
  servicesCreated?: number;
  servicesSkipped?: number;
  locationsLoaded?: number;
  error?: string;
}> {
  console.log(`[onboarding-autocreate] start submission=${submissionId}`);

  // Load submission
  const [sub] = await db
    .select()
    .from(onboardingSubmissions)
    .where(eq(onboardingSubmissions.id, submissionId))
    .limit(1);

  if (!sub) {
    const err = `Submission not found: ${submissionId}`;
    console.error(`[onboarding-autocreate] ${err}`);
    return { success: false, error: err };
  }

  if (sub.status !== "submitted") {
    const err = `Submission status is '${sub.status}', expected 'submitted'`;
    console.error(`[onboarding-autocreate] skipping ${submissionId}: ${err}`);
    return { success: false, error: err };
  }

  const formData = (sub.formData ?? {}) as any;
  const business = formData.business || {};
  const services: string[] = Array.isArray(formData.services) ? formData.services : [];
  const coverage = formData.coverage || {};

  // ── Step 1: Create Account ──────────────────────────────────────────────
  let accountId: string;
  let accountName: string;
  try {
    accountName = (business.brand_name && String(business.brand_name).trim()) ||
                  (business.legal_name && String(business.legal_name).trim()) ||
                  "Untitled Account";
    let baseSlug = slugify(accountName);
    if (!baseSlug) baseSlug = "account-" + Math.random().toString(36).slice(2, 8);

    let finalSlug = baseSlug;
    const existing = await storage.getAccountBySlug(baseSlug);
    if (existing) {
      const suffix = Math.floor(1000 + Math.random() * 9000).toString();
      finalSlug = `${baseSlug}-${suffix}`;
    }

    const account = await storage.createAccount({
      name: accountName,
      slug: finalSlug,
      plan: "starter",
      status: "active",
      agencyId: sub.agencyId ?? undefined,
    } as any);
    accountId = account.id;
    console.log(`[onboarding-autocreate] step 1: account=${accountId} slug=${finalSlug}`);
  } catch (err: any) {
    const note = `Account creation failed: ${err?.message || String(err)}`;
    console.error(`[onboarding-autocreate] ${note}`, err);
    await markFailed(submissionId, note);
    return { success: false, error: note };
  }

  // ── Step 2: Create Website ──────────────────────────────────────────────
  let websiteId: string;
  let domain: string;
  try {
    domain = String(business.domain || "").toLowerCase().trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    if (!domain) throw new Error("missing domain");

    const existingSite = await storage.getWebsiteByDomain(domain);
    if (existingSite) {
      const note = `A website with domain ${domain} already exists. Please contact support.`;
      console.error(`[onboarding-autocreate] step 2: ${note}`);
      await markFailed(submissionId, note);
      return { success: false, accountId, error: note };
    }

    const warmupExpires = new Date();
    warmupExpires.setDate(warmupExpires.getDate() + 30);

    const website = await storage.createWebsite({
      accountId,
      name: accountName,
      domain,
      primaryIndustry: business.industry || undefined,
      status: "paused",
      settings: {
        parentDomain: domain,
        proxyPath: "",
        primaryCity: business.city || "",
        primaryState: business.state || "",
        cityTiers: [],
      },
      onboardingStatus: "creating",
      onboardingSubmissionId: sub.id,
      launchCap: 100,
      warmupMode: true,
      warmupExpiresAt: warmupExpires,
      coveragePlan: String(coverage.level || "regional"),
      tier1WeeklySubmitCap: 50,
    } as any);
    websiteId = website.id;
    console.log(`[onboarding-autocreate] step 2: website=${websiteId} domain=${domain}`);
  } catch (err: any) {
    const note = `Website creation failed: ${err?.message || String(err)}`;
    console.error(`[onboarding-autocreate] ${note}`, err);
    await markFailed(submissionId, note);
    return { success: false, accountId, error: note };
  }

  // ── Step 3: Create Brand Profile ────────────────────────────────────────
  let brandProfileId: string;
  try {
    const bp = await storage.createBrandProfile({
      accountId,
      name: business.brand_name || business.legal_name || accountName,
      primaryColor: business.brand_color || "#3b82f6",
      tagline: business.tagline || "",
      description: `${business.legal_name || accountName} — ${business.industry || "professional"} services in ${business.city || ""}${business.state ? ", " + business.state : ""}.`.trim(),
      phone: business.phone || undefined,
      email: business.email || undefined,
      customFields: {
        legal_name: business.legal_name || "",
        primary_city: business.city || "",
        primary_state: business.state || "",
        industry: business.industry || "",
      },
    } as any);
    brandProfileId = bp.id;

    // Link brand profile back to website (matches agency wizard pattern)
    await storage.updateWebsite(websiteId, { brandProfileId });
    console.log(`[onboarding-autocreate] step 3: brandProfile=${brandProfileId}`);
  } catch (err: any) {
    const note = `Brand profile creation failed: ${err?.message || String(err)}`;
    console.error(`[onboarding-autocreate] ${note}`, err);
    await markFailed(submissionId, note);
    return { success: false, accountId, websiteId, error: note };
  }

  // ── Step 4: Create Services ─────────────────────────────────────────────
  let servicesCreated = 0;
  let servicesSkipped = 0;
  try {
    const existingServices = await storage.getServices(accountId);
    const existingSlugs = new Set(existingServices.map((s: any) => s.slug));

    for (const rawName of services) {
      const name = String(rawName || "").trim();
      if (!name) { servicesSkipped++; continue; }
      let svcSlug = slugify(name);
      if (!svcSlug) { servicesSkipped++; continue; }
      if (existingSlugs.has(svcSlug)) { servicesSkipped++; continue; }
      await storage.createService({
        accountId,
        name,
        slug: svcSlug,
        description: "",
        keywords: [],
      } as any);
      existingSlugs.add(svcSlug);
      servicesCreated++;
    }
    console.log(`[onboarding-autocreate] step 4: services created=${servicesCreated} skipped=${servicesSkipped}`);
  } catch (err: any) {
    const note = `Service creation failed: ${err?.message || String(err)}`;
    console.error(`[onboarding-autocreate] ${note}`, err);
    await markFailed(submissionId, note);
    return { success: false, accountId, websiteId, brandProfileId, servicesCreated, servicesSkipped, error: note };
  }

  // ── Step 5: Import Locations ────────────────────────────────────────────
  let locationsLoaded = 0;
  try {
    const level = String(coverage.level || "regional").toLowerCase().replace(/-/g, "_");
    const citySize = String(coverage.city_size || "medium_and_major").toLowerCase();
    const primaryState = String(business.state || "").toUpperCase();

    let stateFilter: Set<string>;
    if (level === "national") {
      stateFilter = new Set(Object.keys(STATE_ABBR_TO_NAME));
    } else if (level === "multi_state") {
      const arr = Array.isArray(coverage.states) ? coverage.states.map((s: string) => String(s).toUpperCase()) : [];
      stateFilter = new Set(arr.length ? arr : (primaryState ? [primaryState] : []));
    } else {
      // regional or statewide → primary state only
      stateFilter = new Set(primaryState ? [primaryState] : []);
    }

    let popThreshold: number;
    if (citySize === "major") popThreshold = 100000;
    else if (citySize === "all" || citySize === "all_cities") popThreshold = 0;
    else popThreshold = 25000; // medium_and_major (default)

    if (stateFilter.size === 0) {
      throw new Error(`no states resolved for level='${level}'`);
    }

    // Filter master city list, then dedupe by (name+state) keeping highest pop
    const filtered = STANDARD_CITIES.filter(
      (c) => stateFilter.has(c.stateAbbreviation) && c.population >= popThreshold,
    );

    const cityMap = new Map<string, typeof STANDARD_CITIES[0]>();
    for (const c of filtered) {
      const key = `${c.name.toLowerCase()}::${c.stateAbbreviation}`;
      const existing = cityMap.get(key);
      if (!existing || c.population > existing.population) cityMap.set(key, c);
    }

    if (cityMap.size === 0) {
      const stateList = Array.from(stateFilter).join(",");
      throw new Error(`no cities found for ${stateList} with population threshold ${popThreshold}`);
    }

    const items = Array.from(cityMap.values()).map((c) => ({
      accountId,
      type: "city" as const,
      name: c.name,
      slug: `${slugify(c.name)}-${c.stateAbbreviation.toLowerCase()}`,
      stateCode: c.stateAbbreviation,
      stateName: c.stateName,
      population: c.population,
      cityTier: c.population >= 500000 ? 1 : c.population >= 100000 ? 2 : 3,
    }));

    const result = await storage.bulkCreateLocations(accountId, items as any);
    locationsLoaded = result.inserted;
    console.log(`[onboarding-autocreate] step 5: locations loaded=${locationsLoaded} (filtered=${items.length})`);
  } catch (err: any) {
    const note = `Location import failed: ${err?.message || String(err)}`;
    console.error(`[onboarding-autocreate] ${note}`, err);
    await markFailed(submissionId, note);
    return { success: false, accountId, websiteId, brandProfileId, servicesCreated, servicesSkipped, error: note };
  }

  // ── Step 6: Update Records ──────────────────────────────────────────────
  try {
    const summary = `Account created: ${accountName}. Website: ${domain}. Brand profile created. ${servicesCreated} services created. ${locationsLoaded} locations loaded. Ready for readiness scoring.`;

    await db
      .update(onboardingSubmissions)
      .set({
        accountId,
        websiteId,
        status: "ready_for_scoring",
        onboardingNotes: summary,
      })
      .where(eq(onboardingSubmissions.id, submissionId));

    await db
      .update(websitesTable)
      .set({ onboardingStatus: "ready_for_scoring" })
      .where(eq(websitesTable.id, websiteId));

    console.log(`[onboarding-autocreate] step 6: submission marked ready_for_scoring. ${summary}`);
  } catch (err: any) {
    const note = `Final status update failed: ${err?.message || String(err)}`;
    console.error(`[onboarding-autocreate] ${note}`, err);
    await markFailed(submissionId, note);
    return { success: false, accountId, websiteId, brandProfileId, servicesCreated, servicesSkipped, locationsLoaded, error: note };
  }

  return {
    success: true,
    accountId,
    websiteId,
    brandProfileId,
    servicesCreated,
    servicesSkipped,
    locationsLoaded,
  };
}
