import { db } from "../db";
import { eq, sql } from "drizzle-orm";
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

  // ── Step 7: Run readiness scoring synchronously ─────────────────────────
  try {
    await calculateReadinessScore(submissionId);
  } catch (err: any) {
    console.error(`[onboarding-autocreate] readiness scoring threw: ${err?.message}`, err);
    // Do not fail the auto-create — the row is still in a usable state.
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

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 5 — READINESS SCORING
// ═══════════════════════════════════════════════════════════════════════════

const GENERIC_BUSINESS_NAMES = new Set([
  "test", "my business", "company", "business", "example", "untitled",
]);
const GENERIC_SINGLE_WORD_SERVICES = new Set([
  "seo", "marketing", "services", "consulting", "help", "support",
]);
const FREE_HOST_DOMAINS = [
  "blogspot", "wordpress.com", "wix.com", "weebly.com",
  "squarespace.com", "godaddysites.com", "carrd.co",
];

type CritResult = { score: number; max: number; passed: boolean; message?: string };
type CategoryResult = { score: number; max: number; details: Record<string, CritResult> };

interface Gap {
  field: string;
  message: string;
  priority: "low" | "medium" | "high";
  points_available: number;
}
interface Strength {
  field: string;
  message: string;
}

/**
 * Calculates a 0-100 readiness score for an onboarding submission and
 * branches its status to 'ready_for_generation' (>=70) or 'needs_info' (<70).
 *
 * Stores the full score breakdown in onboarding_submissions.readiness_result
 * and the integer score in readiness_score.
 *
 * Customer-facing messages are written in plain English. They do NOT mention
 * AI, internal systems, variation banks, tier logic, or any other internal
 * implementation detail.
 */
export async function calculateReadinessScore(submissionId: string): Promise<{
  success: boolean;
  score?: number;
  status?: string;
  error?: string;
}> {
  console.log(`[onboarding-readiness] start submission=${submissionId}`);

  // Load submission
  const [sub] = await db
    .select()
    .from(onboardingSubmissions)
    .where(eq(onboardingSubmissions.id, submissionId))
    .limit(1);

  if (!sub) {
    const err = `Submission not found: ${submissionId}`;
    console.error(`[onboarding-readiness] ${err}`);
    return { success: false, error: err };
  }

  if (sub.status !== "ready_for_scoring") {
    const err = `Submission status is '${sub.status}', expected 'ready_for_scoring'`;
    console.error(`[onboarding-readiness] skipping ${submissionId}: ${err}`);
    return { success: false, error: err };
  }

  if (!sub.accountId || !sub.websiteId) {
    const err = `Submission ${submissionId} missing accountId or websiteId`;
    console.error(`[onboarding-readiness] ${err}`);
    return { success: false, error: err };
  }

  // Load related records
  const account = await storage.getAccount(sub.accountId);
  const website = await storage.getWebsite(sub.websiteId);
  const brandProfiles = await storage.getBrandProfiles(sub.accountId);
  const brandProfile = brandProfiles[0] || null;
  const services = await storage.getServices(sub.accountId);
  const locations = await storage.getLocations(sub.accountId);

  if (!account || !website) {
    const err = `Account or website missing for submission ${submissionId}`;
    console.error(`[onboarding-readiness] ${err}`);
    return { success: false, error: err };
  }

  const bp: any = brandProfile || {};
  const bpCustom: any = bp.customFields || {};
  const formData: any = sub.formData || {};
  const planType = String(sub.planType || "").toLowerCase();
  const coveragePlan = String((website as any).coveragePlan || formData.coverage?.level || "").toLowerCase();
  const coverageStates: string[] = Array.isArray(formData.coverage?.states) ? formData.coverage.states : [];

  const gaps: Gap[] = [];
  const strengths: Strength[] = [];

  const phoneDigitCount = (s: string | null | undefined) =>
    (s || "").replace(/[^0-9]/g, "").length;
  const isValidEmail = (s: string | null | undefined) =>
    !!s && s.includes("@") && s.includes(".");

  // ── DOMAIN (15 points) ─────────────────────────────────────────────────
  const domain = String((website as any).domain || "").trim().toLowerCase();
  const domainPresent: CritResult = domain
    ? { score: 10, max: 10, passed: true }
    : { score: 0, max: 10, passed: false, message: "No domain on file." };
  const domainLooksFree = FREE_HOST_DOMAINS.some((h) => domain.includes(h));
  const domainQuality: CritResult = domain && !domainLooksFree
    ? { score: 5, max: 5, passed: true }
    : { score: 0, max: 5, passed: false, message: domain && domainLooksFree
        ? "Free hosting domains are not supported. A custom domain is required."
        : "No domain on file." };
  const domainCat: CategoryResult = {
    score: domainPresent.score + domainQuality.score,
    max: 15,
    details: { domain_present: domainPresent, domain_quality: domainQuality },
  };
  if (!domainPresent.passed) gaps.push({ field: "domain", message: "A custom domain is required to publish pages.", priority: "high", points_available: 10 });
  if (!domainQuality.passed && domainPresent.passed) gaps.push({ field: "domain", message: "The domain provided appears to be on a free hosting platform. A custom domain is required.", priority: "high", points_available: 5 });
  if (domainCat.score === domainCat.max) strengths.push({ field: "domain", message: "Domain is valid and properly formatted." });

  // ── BRAND PROFILE (15 points) ──────────────────────────────────────────
  const businessName = String(bp.name || "").trim();
  const businessNameLower = businessName.toLowerCase();
  const businessNameOk = businessName.length > 2 && !GENERIC_BUSINESS_NAMES.has(businessNameLower);
  const businessNameCrit: CritResult = businessNameOk
    ? { score: 5, max: 5, passed: true }
    : { score: 0, max: 5, passed: false, message: "Business name is missing or too generic." };

  const phone = String(bp.phone || "").trim();
  const phoneOk = phoneDigitCount(phone) >= 10;
  const phoneCrit: CritResult = phoneOk
    ? { score: 3, max: 3, passed: true }
    : { score: 0, max: 3, passed: false, message: "No phone number on file. Pages will not have a call CTA." };

  const email = String(bp.email || "").trim();
  const emailOk = isValidEmail(email);
  const emailCrit: CritResult = emailOk
    ? { score: 3, max: 3, passed: true }
    : { score: 0, max: 3, passed: false, message: "No email on file. Pages will not have an email CTA." };

  const tagline = String(bp.tagline || "").trim();
  const taglineOk = tagline.length > 5;
  const taglineCrit: CritResult = taglineOk
    ? { score: 2, max: 2, passed: true }
    : { score: 0, max: 2, passed: false, message: "No tagline provided. Adding a tagline improves page quality." };

  const primaryCity = String(bpCustom.primary_city || "").trim();
  const primaryState = String(bpCustom.primary_state || "").trim();
  const locationOk = primaryCity.length > 0 && primaryState.length > 0;
  const locationCrit: CritResult = locationOk
    ? { score: 2, max: 2, passed: true }
    : { score: 0, max: 2, passed: false, message: "Primary city or state is missing from the brand profile." };

  const brandCat: CategoryResult = {
    score: businessNameCrit.score + phoneCrit.score + emailCrit.score + taglineCrit.score + locationCrit.score,
    max: 15,
    details: {
      business_name: businessNameCrit,
      phone_present: phoneCrit,
      email_present: emailCrit,
      tagline_present: taglineCrit,
      location_present: locationCrit,
    },
  };
  if (!businessNameCrit.passed) gaps.push({ field: "business_name", message: "Business name is missing or appears to be a placeholder. Please provide your real business name.", priority: "high", points_available: 5 });
  if (!phoneCrit.passed) gaps.push({ field: "phone", message: "No phone number on file. Adding a phone number adds a call button to every page.", priority: "high", points_available: 3 });
  if (!emailCrit.passed) gaps.push({ field: "email", message: "No email on file. Adding an email lets visitors contact you in writing.", priority: "medium", points_available: 3 });
  if (!taglineCrit.passed) gaps.push({ field: "tagline", message: "No tagline provided. Adding a short tagline (e.g. 'Family-owned plumbing in Denver since 1998') improves page quality.", priority: "low", points_available: 2 });
  if (!locationCrit.passed) gaps.push({ field: "primary_location", message: "Primary city or state is missing. This is needed to localize your pages.", priority: "high", points_available: 2 });
  if (brandCat.score === brandCat.max) strengths.push({ field: "brand_profile", message: "Brand profile is complete with name, phone, email, tagline, and location." });

  // ── SERVICES (25 points) ───────────────────────────────────────────────
  const serviceNames: string[] = services.map((s: any) => String(s.name || "").trim()).filter(Boolean);
  const serviceCount = serviceNames.length;

  let minServicesScore = 0;
  if (serviceCount >= 3) minServicesScore = 10;
  else if (serviceCount >= 1) minServicesScore = 5;
  const minServicesCrit: CritResult = {
    score: minServicesScore,
    max: 10,
    passed: minServicesScore === 10,
    message: minServicesScore < 10 ? `Only ${serviceCount} service(s) defined. At least 3 are recommended.` : undefined,
  };

  let goodCountScore = 0;
  if (serviceCount >= 8) goodCountScore = 5;
  else if (serviceCount >= 5) goodCountScore = 3;
  const goodCountCrit: CritResult = {
    score: goodCountScore,
    max: 5,
    passed: goodCountScore === 5,
    message: goodCountScore < 5 ? `Adding more services (8 or more) improves coverage.` : undefined,
  };

  const hasGenericService = serviceNames.some((n) => {
    const words = n.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length === 1 && GENERIC_SINGLE_WORD_SERVICES.has(words[0]);
  });
  const noGenericCrit: CritResult = !hasGenericService && serviceCount > 0
    ? { score: 5, max: 5, passed: true }
    : { score: 0, max: 5, passed: false, message: hasGenericService
        ? "One or more services use a single generic word (e.g. 'SEO', 'Marketing'). Use specific 2+ word names."
        : "No services to evaluate." };

  let avgWords = 0;
  if (serviceCount > 0) {
    const total = serviceNames.reduce((sum, n) => sum + n.split(/\s+/).filter(Boolean).length, 0);
    avgWords = total / serviceCount;
  }
  let nameQualityScore = 0;
  if (avgWords > 3) nameQualityScore = 5;
  else if (avgWords > 2) nameQualityScore = 3;
  const nameQualityCrit: CritResult = {
    score: nameQualityScore,
    max: 5,
    passed: nameQualityScore === 5,
    message: nameQualityScore < 5 ? `Service names average ${avgWords.toFixed(1)} words. More descriptive names (e.g. 'Emergency Drain Cleaning') score better.` : undefined,
  };

  const servicesCat: CategoryResult = {
    score: minServicesCrit.score + goodCountCrit.score + noGenericCrit.score + nameQualityCrit.score,
    max: 25,
    details: {
      minimum_services: minServicesCrit,
      good_service_count: goodCountCrit,
      no_generic_services: noGenericCrit,
      service_name_quality: nameQualityCrit,
    },
  };
  if (!minServicesCrit.passed) gaps.push({ field: "services_minimum", message: serviceCount === 0
    ? "No services defined. At least 3 services are recommended for good page coverage."
    : `Only ${serviceCount} service(s) defined. At least 3 are recommended.`,
    priority: serviceCount === 0 ? "high" : "medium",
    points_available: 10 - minServicesScore });
  if (!goodCountCrit.passed && serviceCount > 0) gaps.push({ field: "services_count", message: `${serviceCount} services defined. Adding more (8 or more) improves coverage.`, priority: "low", points_available: 5 - goodCountScore });
  if (!noGenericCrit.passed && serviceCount > 0) gaps.push({ field: "services_generic", message: "One or more service names are too generic (e.g. 'SEO'). Use specific 2+ word names like 'Local SEO Audit'.", priority: "medium", points_available: 5 });
  if (!nameQualityCrit.passed && serviceCount > 0) gaps.push({ field: "service_names", message: "Service names are short. More descriptive names (3+ words) produce better pages.", priority: "low", points_available: 5 - nameQualityScore });
  if (servicesCat.score === servicesCat.max) strengths.push({ field: "services", message: `${serviceCount} services defined with good naming quality.` });

  // ── COVERAGE (20 points) ────────────────────────────────────────────────
  const locCount = locations.length;

  let coverageMatchScore = 10;
  let coverageMatchMessage: string | undefined;
  if (planType === "local_launch") {
    if (coveragePlan === "national") {
      coverageMatchScore = 0;
      coverageMatchMessage = "Coverage plan 'national' is too aggressive for the Local Launch tier.";
    } else if (coveragePlan === "multi_state" && coverageStates.length > 3) {
      coverageMatchScore = 0;
      coverageMatchMessage = `Coverage plan covers ${coverageStates.length} states, which exceeds the Local Launch limit of 3.`;
    }
  }
  const coverageMatchCrit: CritResult = {
    score: coverageMatchScore,
    max: 10,
    passed: coverageMatchScore === 10,
    message: coverageMatchMessage,
  };

  let enoughCitiesScore = 0;
  if (locCount > 10) enoughCitiesScore = 5;
  else if (locCount > 0) enoughCitiesScore = 3;
  const enoughCitiesCrit: CritResult = {
    score: enoughCitiesScore,
    max: 5,
    passed: enoughCitiesScore === 5,
    message: enoughCitiesScore < 5 ? `Only ${locCount} city/cities loaded. More than 10 is recommended.` : undefined,
  };

  let notTooManyScore = 5;
  let notTooManyMessage: string | undefined;
  if (planType === "local_launch" && locCount > 1000) {
    notTooManyScore = 0;
    notTooManyMessage = `${locCount} locations is too many for the Local Launch tier (limit: 1000).`;
  } else if (planType === "growth_bundle" && locCount > 5000) {
    notTooManyScore = 0;
    notTooManyMessage = `${locCount} locations is too many for the Growth Bundle tier (limit: 5000).`;
  }
  const notTooManyCrit: CritResult = {
    score: notTooManyScore,
    max: 5,
    passed: notTooManyScore === 5,
    message: notTooManyMessage,
  };

  const coverageCat: CategoryResult = {
    score: coverageMatchCrit.score + enoughCitiesCrit.score + notTooManyCrit.score,
    max: 20,
    details: {
      coverage_matches_plan: coverageMatchCrit,
      enough_cities: enoughCitiesCrit,
      not_too_many_cities: notTooManyCrit,
    },
  };
  if (!coverageMatchCrit.passed) gaps.push({ field: "coverage_plan", message: coverageMatchMessage || "Coverage plan does not match the selected tier.", priority: "high", points_available: 10 });
  if (!enoughCitiesCrit.passed) gaps.push({ field: "city_count", message: locCount === 0
    ? "No cities loaded. Pages cannot be generated without locations."
    : `Only ${locCount} city/cities loaded. More than 10 is recommended.`,
    priority: locCount === 0 ? "high" : "low",
    points_available: 5 - enoughCitiesScore });
  if (!notTooManyCrit.passed) gaps.push({ field: "city_count_max", message: notTooManyMessage || "Too many locations for this plan tier.", priority: "high", points_available: 5 });
  if (coverageCat.score === coverageCat.max) {
    const stateSet = new Set(locations.map((l: any) => l.stateCode || l.state_code).filter(Boolean));
    const stateLabel = stateSet.size === 1 ? `across ${Array.from(stateSet)[0]}` : `across ${stateSet.size} states`;
    strengths.push({ field: "coverage", message: `Coverage plan is appropriate. ${locCount} cities loaded ${stateLabel}.` });
  }

  // ── LOCATIONS (10 points) ──────────────────────────────────────────────
  const locExistCrit: CritResult = locCount > 0
    ? { score: 10, max: 10, passed: true }
    : { score: 0, max: 10, passed: false, message: "No locations loaded. Pages cannot be generated." };
  const locationsCat: CategoryResult = {
    score: locExistCrit.score,
    max: 10,
    details: { locations_exist: locExistCrit },
  };
  if (!locExistCrit.passed) gaps.push({ field: "locations", message: "No cities loaded for this account. Page generation requires at least one city.", priority: "high", points_available: 10 });
  if (locationsCat.score === locationsCat.max) strengths.push({ field: "locations", message: `${locCount} cities loaded.` });

  // ── CTA / CONTACT (15 points) ──────────────────────────────────────────
  const phoneCtaCrit: CritResult = phoneOk
    ? { score: 5, max: 5, passed: true }
    : { score: 0, max: 5, passed: false, message: "Phone is required for the call CTA on every page." };
  const emailCtaCrit: CritResult = emailOk
    ? { score: 5, max: 5, passed: true }
    : { score: 0, max: 5, passed: false, message: "Email is required for the contact CTA." };
  const localCtxCrit: CritResult = locationOk
    ? { score: 5, max: 5, passed: true }
    : { score: 0, max: 5, passed: false, message: "Primary city and state are required to localize page content." };
  const ctaCat: CategoryResult = {
    score: phoneCtaCrit.score + emailCtaCrit.score + localCtxCrit.score,
    max: 15,
    details: {
      phone_for_cta: phoneCtaCrit,
      email_for_cta: emailCtaCrit,
      local_context: localCtxCrit,
    },
  };
  // (Phone / email / location gaps already added in brand profile section — do not duplicate.)
  if (ctaCat.score === ctaCat.max) strengths.push({ field: "cta_contact", message: "Phone, email, and local context are all set for page CTAs." });

  // ── TOTAL ──────────────────────────────────────────────────────────────
  const totalScore =
    domainCat.score + brandCat.score + servicesCat.score +
    coverageCat.score + locationsCat.score + ctaCat.score;

  const result = {
    score: totalScore,
    max_score: 100,
    calculated_at: new Date().toISOString(),
    breakdown: {
      domain: domainCat,
      brand_profile: brandCat,
      services: servicesCat,
      coverage: coverageCat,
      locations: locationsCat,
      cta_contact: ctaCat,
    },
    gaps,
    strengths,
  };

  // ── Branching ──────────────────────────────────────────────────────────
  let newSubStatus: string;
  let newWebsiteStatus: string;
  let notes: string;
  const gapList = gaps.length
    ? gaps.map((g) => `• ${g.message}`).join("\n")
    : "(none)";

  if (totalScore >= 70) {
    newSubStatus = "ready_for_generation";
    newWebsiteStatus = "ready_for_generation";
    notes = `Readiness score: ${totalScore}/100. Account is ready for page generation.`;
    console.log(`[Onboarding] Submission ${submissionId} scored ${totalScore}/100. Status: ready_for_generation.`);
  } else if (totalScore >= 50) {
    newSubStatus = "needs_info";
    newWebsiteStatus = "needs_info";
    notes = `Readiness score: ${totalScore}/100. The following items need attention before page generation can begin:\n${gapList}`;
    console.log(`[Onboarding] Submission ${submissionId} scored ${totalScore}/100. Status: needs_info. Gaps: ${gaps.map(g => g.field).join(", ")}.`);
  } else {
    newSubStatus = "needs_info";
    newWebsiteStatus = "needs_info";
    notes = `Readiness score: ${totalScore}/100. SIGNIFICANT GAPS DETECTED. Admin review recommended before proceeding. Missing:\n${gapList}`;
    console.log(`[Onboarding] Submission ${submissionId} scored ${totalScore}/100. LOW SCORE — admin review needed. Gaps: ${gaps.map(g => g.field).join(", ")}.`);
  }

  // Phase 8 Rail 2 — Brand-Input Completeness Gate
  let brandGateNote = "";
  try {
    const { checkBrandInputQuality } = await import("./brand-input-gate");
    const brandResult = await checkBrandInputQuality(submissionId);
    if (brandResult.decision === "block") {
      newSubStatus = "needs_info";
      newWebsiteStatus = "needs_info";
      brandGateNote = `\n\nBrand profile is incomplete (${brandResult.score}/30). The following must be added before pages can be prepared: ${brandResult.zero_items.join(", ")}.`;
    } else if (brandResult.decision === "warn") {
      brandGateNote = `\n\nBrand profile could be stronger (${brandResult.score}/30). Adding more detail will improve every page on your site.`;
    }
  } catch (err: any) {
    console.error("[Brand Input Gate] Failed (non-fatal):", err?.message);
  }

  await db
    .update(onboardingSubmissions)
    .set({
      readinessScore: totalScore,
      readinessResult: result as any,
      status: newSubStatus,
      onboardingNotes: notes + brandGateNote,
    })
    .where(eq(onboardingSubmissions.id, submissionId));

  await db
    .update(websitesTable)
    .set({ onboardingStatus: newWebsiteStatus })
    .where(eq(websitesTable.id, sub.websiteId));

  // Phase 9 — Generate customer-friendly gap report after Phase 5
  try {
    const { generateGapReport } = await import("./gap-report");
    await generateGapReport(submissionId);
  } catch (err: any) {
    console.error("[Gap Report] Phase 5 generation failed (non-fatal):", err?.message);
  }

  // Phase 6 — fire-and-forget background generation pipeline.
  // MUST run AFTER both DB writes commit so the pipeline reads the
  // 'ready_for_generation' state. setImmediate defers until after this tick.
  if (newSubStatus === "ready_for_generation") {
    setImmediate(() => {
      runOnboardingGeneration(submissionId).catch(async (err: any) => {
        console.error(`[Onboarding Generation] Pipeline failed for ${submissionId}:`, err?.message);
        try {
          await db
            .update(onboardingSubmissions)
            .set({
              status: "needs_info",
              onboardingNotes: `Generation pipeline failed: ${err?.message || "unknown error"}. Admin review required.`,
            })
            .where(eq(onboardingSubmissions.id, submissionId));
        } catch { /* best-effort */ }
      });
    });
  }

  return { success: true, score: totalScore, status: newSubStatus };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6 — Draft-First Generation Pipeline
// ═══════════════════════════════════════════════════════════════════════════
// Triggered after readiness scoring reaches 'ready_for_generation' (>=70) or
// after admin override. Runs 9 steps in order, each must complete before next.
// All pages produced are DRAFTS (is_draft=true, status='draft', publish_wave=0).
// Nothing is published, sitemapped, or submitted to Google in this phase.
// Phase 7 launch governors will decide which drafts go live.
// ═══════════════════════════════════════════════════════════════════════════

const SCORING_POLL_INTERVAL_MS = 5000;
const SCORING_POLL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

async function appendOnboardingNote(submissionId: string, line: string): Promise<void> {
  const [row] = await db
    .select({ notes: onboardingSubmissions.onboardingNotes })
    .from(onboardingSubmissions)
    .where(eq(onboardingSubmissions.id, submissionId))
    .limit(1);
  const newNotes = (row?.notes || "") + (row?.notes ? "\n" : "") + line;
  await db
    .update(onboardingSubmissions)
    .set({ onboardingNotes: newNotes })
    .where(eq(onboardingSubmissions.id, submissionId));
}

export async function runOnboardingGeneration(submissionId: string, opts?: { overwrite?: boolean }): Promise<{
  success: boolean;
  totalDrafted?: number;
  tier1?: number;
  tier2?: number;
  tier3?: number;
  averageScore?: number;
  error?: string;
}> {
  const overwrite = opts?.overwrite ?? false;
  const startedAt = new Date();
  console.log(`[Onboarding Generation] Starting for submission ${submissionId}${overwrite ? " (overwrite=true)" : ""}`);

  try {
    // ── Load submission and confirm state ─────────────────────────────────
    const [sub] = await db
      .select()
      .from(onboardingSubmissions)
      .where(eq(onboardingSubmissions.id, submissionId))
      .limit(1);
    if (!sub) throw new Error(`Submission ${submissionId} not found`);
    if (!overwrite && (sub.status === "generating" || sub.status === "generated_draft_only" || sub.status === "published_live")) {
      // Idempotency — pipeline already ran or is running for this submission.
      // Skipped only when overwrite=false; with overwrite=true we fall through.
      console.warn(`[Onboarding Generation] Submission ${submissionId} already at status '${sub.status}'. Skipping duplicate run.`);
      return { success: true };
    }
    if (sub.status !== "ready_for_generation") {
      throw new Error(`Submission status is '${sub.status}', expected 'ready_for_generation'`);
    }
    if (!sub.accountId || !sub.websiteId) {
      throw new Error(`Submission ${submissionId} missing accountId or websiteId`);
    }
    const accountId = sub.accountId;
    const websiteId = sub.websiteId;

    const website = await storage.getWebsite(websiteId);
    if (!website) throw new Error(`Website ${websiteId} not found`);
    const account = await storage.getAccount(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);
    const brand = website.brandProfileId ? await storage.getBrandProfile(website.brandProfileId) : null;

    console.log(`[Onboarding Generation] Account ${accountId}, website ${websiteId} (${website.domain})`);

    // ── STEP 1 — Update status to 'generating' ────────────────────────────
    await db
      .update(onboardingSubmissions)
      .set({ status: "generating", generationStartedAt: startedAt })
      .where(eq(onboardingSubmissions.id, submissionId));
    await db
      .update(websitesTable)
      .set({ onboardingStatus: "generating" })
      .where(eq(websitesTable.id, websiteId));

    // ── STEP 2 — Variation banks ──────────────────────────────────────────
    const services = await storage.getServices(accountId);
    if (services.length === 0) throw new Error("No services found for account");

    const { fillMissingSectionsForService } = await import("./variation-writer");
    const { computeBankCompleteness } = await import("./scoring");

    const brandCtx = {
      brandName: brand?.name || website.name || undefined,
      brandDescription: (brand as any)?.description ?? undefined,
      voiceAndTone: (brand as any)?.voiceAndTone ?? undefined,
      industryName: (account as any)?.settings?.industry || undefined,
      industryDescription: undefined,
    };

    let banksWritten = 0;
    let banksSkipped = 0;
    for (const svc of services) {
      try {
        const result = await fillMissingSectionsForService(svc.name, accountId, websiteId, brandCtx);
        if (result.filled.length > 0) banksWritten++;
        else banksSkipped++;
      } catch (err: any) {
        console.error(`[Onboarding Generation] Bank write failed for "${svc.name}":`, err?.message);
        // Continue — Phase 7 governors will gate per-service quality
      }
    }

    // Bank health summary
    let avgCompleteness = 0;
    let serviceCount = 0;
    for (const svc of services) {
      try {
        const banks = await storage.getVariationBanks(websiteId, svc.name);
        if (banks.length > 0) {
          const c = computeBankCompleteness(banks);
          avgCompleteness += c.completenessScore;
          serviceCount++;
        }
      } catch { /* skip */ }
    }
    avgCompleteness = serviceCount > 0 ? Math.round(avgCompleteness / serviceCount) : 0;
    console.log(`[Onboarding Generation] Variation banks created for ${banksWritten + banksSkipped} services. Average completeness: ${avgCompleteness}%.`);

    // ── STEP 3 — Blueprints (5 standard types) ────────────────────────────
    const { generateBlueprint } = await import("./claude");
    const businessName = brand?.name || website.name || website.domain;
    const industry = (account as any)?.settings?.industry || (brand as any)?.description || "Local Service";

    const allBlueprints = await storage.getBlueprints(accountId);
    const existingBlueprints = allBlueprints.filter((b: any) => !b.websiteId || b.websiteId === websiteId);
    const existingPageTypes = new Set<string>(existingBlueprints.map((b: any) => String(b.pageType)));

    const blueprintSpecs: Array<{ pageType: any; service?: string }> = [
      { pageType: "service_city" },
      { pageType: "state_hub" },
      { pageType: "city_hub" },
      { pageType: "industry_city" },
      { pageType: "problem_intent" },
    ];

    let blueprintsCreated = 0;
    for (const spec of blueprintSpecs) {
      if (existingPageTypes.has(spec.pageType)) continue;
      try {
        const gen = await generateBlueprint({ businessName, industry, pageType: spec.pageType as any });
        await storage.createBlueprint({
          ...gen,
          accountId,
          websiteId,
          requiredWordCount: gen.requiredWordCount,
          minPublishScore: gen.minPublishScore as any,
          faqEnabled: gen.faqEnabled,
        } as any);
        blueprintsCreated++;
      } catch (err: any) {
        console.error(`[Onboarding Generation] Blueprint ${spec.pageType} failed:`, err?.message);
      }
    }
    console.log(`[Onboarding Generation] ${blueprintsCreated} blueprints created for website ${websiteId}.`);

    // ── STEP 4 — Query clusters ───────────────────────────────────────────
    const { generateQueryClusters } = await import("./claude");
    const existingClusters = await storage.getQueryClusters(accountId);
    const existingKeywords = new Set(existingClusters.map((c: any) => c.primaryKeyword.toLowerCase()));
    const serviceNameToId = new Map(services.map((s: any) => [s.name.toLowerCase(), s.id]));

    let clustersCreated = 0;
    try {
      const generated = await generateQueryClusters({
        businessName,
        industry,
        services: services.map((s: any) => s.name),
        existingClusters: existingClusters.map((c: any) => c.primaryKeyword),
      });

      for (const c of generated) {
        if (existingKeywords.has(c.primaryKeyword.toLowerCase())) continue;
        // Auto-link to a service if keyword mentions it
        let serviceId: string | null = null;
        const kwLower = c.primaryKeyword.toLowerCase();
        for (const [svcName, svcId] of Array.from(serviceNameToId.entries())) {
          if (kwLower.includes(svcName)) { serviceId = svcId as string; break; }
        }
        try {
          await storage.createQueryCluster({ ...c, accountId, serviceId } as any);
          existingKeywords.add(c.primaryKeyword.toLowerCase());
          clustersCreated++;
        } catch (err: any) {
          console.error(`[Onboarding Generation] Cluster insert failed for "${c.primaryKeyword}":`, err?.message);
        }
      }
    } catch (err: any) {
      console.error(`[Onboarding Generation] Cluster generation failed:`, err?.message);
    }
    console.log(`[Onboarding Generation] ${clustersCreated} query clusters created for account ${accountId}.`);

    // ── STEP 5 — Hub pages ────────────────────────────────────────────────
    const locations = await storage.getLocations(accountId);
    const cityLocs = locations.filter((l: any) => l.type === "city");
    const stateLocs = locations.filter((l: any) => l.type === "state");

    // Service hubs — one per service
    let serviceHubsCreated = 0;
    for (const svc of services) {
      const slug = `services/${slugify(svc.name)}`;
      try {
        await storage.createHubPage({
          websiteId,
          accountId,
          hubType: "service",
          name: svc.name,
          slug,
          parentSlug: null,
          maxChildLinks: 30,
          metaDescription: `Browse all ${svc.name} pages and locations served.`,
          status: "draft",
          tier: 1,
        } as any);
        serviceHubsCreated++;
      } catch { /* may exist */ }
    }

    // State hubs — one per state in coverage
    const stateAbbrSet = new Set<string>();
    for (const loc of locations) {
      if (loc.stateCode) stateAbbrSet.add(loc.stateCode.toUpperCase());
    }
    let stateHubsCreated = 0;
    for (const abbr of Array.from(stateAbbrSet)) {
      const stateName = STATE_ABBR_TO_NAME[abbr] || abbr;
      const slug = `locations/${slugify(stateName)}`;
      try {
        await storage.createHubPage({
          websiteId,
          accountId,
          hubType: "state",
          name: stateName,
          slug,
          parentSlug: null,
          maxChildLinks: 30,
          metaDescription: `All locations and services we serve in ${stateName}.`,
          status: "draft",
          tier: 1,
        } as any);
        stateHubsCreated++;
      } catch { /* skip */ }
    }

    // City hubs — apply >1000 cap by tier (1 + 2 only when over cap)
    let cityHubCandidates = cityLocs;
    if (cityLocs.length > 1000) {
      cityHubCandidates = cityLocs.filter((l: any) => {
        const tier = l.cityTier ?? (l.population && l.population >= 500000 ? 1 : l.population && l.population >= 100000 ? 2 : 3);
        return tier === 1 || tier === 2;
      });
      console.log(`[Onboarding Generation] City hub cap applied: ${cityLocs.length} candidates → ${cityHubCandidates.length} after Tier 1+2 filter.`);
    }
    let cityHubsCreated = 0;
    for (const loc of cityHubCandidates) {
      const stateName = loc.stateName || (loc.stateCode ? STATE_ABBR_TO_NAME[loc.stateCode.toUpperCase()] : "");
      const slug = `locations/${slugify(stateName || "us")}/${slugify(loc.name)}`;
      try {
        await storage.createHubPage({
          websiteId,
          accountId,
          hubType: "city",
          name: loc.name,
          slug,
          parentSlug: stateName ? `locations/${slugify(stateName)}` : null,
          maxChildLinks: 30,
          metaDescription: `Services we offer in ${loc.name}${stateName ? `, ${stateName}` : ""}.`,
          status: "draft",
          tier: 1,
        } as any);
        cityHubsCreated++;
      } catch { /* skip */ }
    }
    console.log(`[Onboarding Generation] Hub pages created: ${serviceHubsCreated} service hubs, ${stateHubsCreated} state hubs, ${cityHubsCreated} city hubs.`);

    // ── STEP 6 — Bulk generation as DRAFTS ────────────────────────────────
    const { runBulkBackgroundJob } = await import("./bulk-background");

    // Build job settings — full matrix, no overwrite, isDraft=true
    const stateAbbrs = Array.from(stateAbbrSet);
    const cityList = cityLocs.map((l: any) => ({
      name: l.name,
      stateAbbr: (l.stateCode || "").toUpperCase(),
    }));

    // Mode selection: prefer cities if any present, else states
    let mode: "all_states" | "specific_states" | "specific_cities";
    let modeSettings: any;
    if (cityList.length > 0) {
      mode = "specific_cities";
      modeSettings = { cities: cityList };
    } else if (stateAbbrs.length > 0) {
      mode = "specific_states";
      modeSettings = { states: stateAbbrs };
    } else {
      mode = "all_states";
      modeSettings = {};
    }

    const allClusters = await storage.getQueryClusters(accountId);

    const bulkJob = await storage.createGenerationJob({
      accountId,
      websiteId,
      name: `Onboarding Draft Generation: ${website.domain}`,
      status: "pending",
      totalPages: 0,
      processedPages: 0,
      passedPages: 0,
      failedPages: 0,
      settings: {
        services: services.map((s: any) => s.name),
        queryClusterIds: allClusters.map((c: any) => c.id),
        mode,
        ...modeSettings,
        overwrite,
        isDraft: true,
        draftReason: "onboarding_initial",
        progress: services.map((s: any) => ({
          service: s.name,
          status: "pending",
          created: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
        })),
      } as any,
    });

    console.log(`[Onboarding Generation] Bulk draft generation job ${bulkJob.id} queued. Awaiting completion...`);
    await runBulkBackgroundJob(bulkJob.id);

    const finishedJob = await storage.getGenerationJob(bulkJob.id);
    const draftCreated = finishedJob?.passedPages || 0;
    const draftSkipped = (finishedJob as any)?.settings?.progress?.reduce?.(
      (acc: number, p: any) => acc + (p.skipped || 0), 0,
    ) || 0;
    console.log(`[Onboarding Generation] Bulk generation complete. ${draftCreated} draft pages created, ${draftSkipped} skipped.`);

    // ── STEP 7 + 8 — Wait for auto-scoring/tiering job to complete ────────
    // runBulkBackgroundJob queues runAutoScoringJob via setImmediate at the end.
    // Poll for the most recent Auto-Score job for this website to finish.
    const { generationJobs } = await import("@shared/schema");
    const { desc, and: dAnd, eq: dEq, like } = await import("drizzle-orm");

    const pollStart = Date.now();
    let scoringJobComplete = false;
    let scoringJobRow: any = null;
    while (Date.now() - pollStart < SCORING_POLL_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, SCORING_POLL_INTERVAL_MS));
      const [latest] = await db
        .select()
        .from(generationJobs)
        .where(dAnd(dEq(generationJobs.websiteId, websiteId), like(generationJobs.name, "Auto-Score:%")))
        .orderBy(desc(generationJobs.createdAt))
        .limit(1);
      if (latest && (latest.status === "completed" || latest.status === "failed" || latest.status === "cancelled" || (latest.status as any) === "error")) {
        scoringJobComplete = true;
        scoringJobRow = latest;
        break;
      }
    }
    if (!scoringJobComplete) {
      console.warn(`[Onboarding Generation] Auto-scoring job did not complete within ${SCORING_POLL_TIMEOUT_MS / 1000}s — continuing anyway.`);
    }

    // ── Score / tier breakdown for final notes ─────────────────────────────
    const { pages: pagesTable } = await import("@shared/schema");
    const { sql } = await import("drizzle-orm");

    const [counts] = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE is_draft = true)::int AS total_drafts,
        COUNT(*) FILTER (WHERE is_draft = true AND tier = 1)::int AS tier1,
        COUNT(*) FILTER (WHERE is_draft = true AND tier = 2)::int AS tier2,
        COUNT(*) FILTER (WHERE is_draft = true AND tier = 3)::int AS tier3,
        COALESCE(AVG(quality_score) FILTER (WHERE is_draft = true AND quality_score IS NOT NULL), 0)::int AS avg_score
      FROM pages
      WHERE website_id = ${websiteId}
    `).then((r: any) => (r.rows ? r.rows : r)) as any;

    const totalDrafted = counts?.total_drafts ?? 0;
    const tier1 = counts?.tier1 ?? 0;
    const tier2 = counts?.tier2 ?? 0;
    const tier3 = counts?.tier3 ?? 0;
    const avgScore = counts?.avg_score ?? 0;

    console.log(`[Onboarding Generation] Auto-scoring complete. Average score: ${avgScore}. Tier 1: ${tier1}, Tier 2: ${tier2}, Tier 3: ${tier3}.`);

    // ── STEP 9 — Final status update ──────────────────────────────────────
    await db
      .update(onboardingSubmissions)
      .set({ status: "generated_draft_only" })
      .where(eq(onboardingSubmissions.id, submissionId));
    await db
      .update(websitesTable)
      .set({ onboardingStatus: "generated_draft_only" })
      .where(eq(websitesTable.id, websiteId));

    const finalNote = `Generation complete at ${new Date().toISOString()}. ${totalDrafted} draft pages created. ${tier1} scored Tier 1. ${tier2} scored Tier 2. ${tier3} scored Tier 3. Average quality score: ${avgScore}. Awaiting launch governor review (Phase 7).`;
    await appendOnboardingNote(submissionId, finalNote);

    console.log(`[Onboarding Generation] Pipeline complete for submission ${submissionId}. Status: generated_draft_only. Awaiting Phase 7 launch governors.`);

    // Phase 9 — Refresh customer-friendly gap report after Phase 6 completes
    try {
      const { generateGapReport } = await import("./gap-report");
      await generateGapReport(submissionId);
    } catch (err: any) {
      console.error("[Gap Report] Phase 6 generation failed (non-fatal):", err?.message);
    }

    // ── STEP 10 — Trigger Phase 7 Launch Governors ───────────────────────
    // Fire-and-forget: launch governors should never block or fail onboarding.
    setImmediate(async () => {
      try {
        const { runLaunchGovernors } = await import("./launch-governors");
        await runLaunchGovernors(websiteId);
      } catch (err: any) {
        console.error(`[Onboarding Generation] Launch governors failed for ${websiteId} (non-fatal):`, err?.message);
      }
    });

    return {
      success: true,
      totalDrafted,
      tier1,
      tier2,
      tier3,
      averageScore: avgScore,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`[Onboarding Generation] FAILED for ${submissionId}:`, msg);
    try {
      await db
        .update(onboardingSubmissions)
        .set({
          status: "needs_info",
          onboardingNotes: `Generation pipeline failed: ${msg}. Admin review required.`,
        })
        .where(eq(onboardingSubmissions.id, submissionId));
    } catch { /* best-effort */ }
    return { success: false, error: msg };
  }
}
