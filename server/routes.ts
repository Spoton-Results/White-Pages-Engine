import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { sessionMiddleware, requireAuth, requireSuperAdmin, loginUser, hashPassword } from "./auth";
import callTrackingRouter from "./routes/call-tracking";
import formTrackingRouter from "./routes/form-tracking";
import leadsRouter from "./routes/leads";
import dashboardAgencyRouter from "./routes/dashboard-agency";
import dashboardAdminRouter from "./routes/dashboard-admin";
import widgetRouter from "./routes/widget";
import * as storage from "./storage";
import { runGenerationJob } from "./services/generation";
import { generateBlueprint, suggestServices, generateQueryClusters } from "./services/claude";
import { buildVariationPage } from "./services/variation-engine";
import { writeVariationsForService, fillMissingSectionsForService, BrandContext } from "./services/variation-writer";
import { generateSitemapsForWebsite, generateRobotsTxt, URLS_PER_SITEMAP } from "./services/sitemap";
import { processOnboardingSubmission, calculateReadinessScore } from "./services/onboarding";
import { isR2Configured } from "./services/r2";
import {
  insertAccountSchema, insertUserSchema, insertBrandProfileSchema,
  insertWebsiteSchema, insertLocationSchema, insertServiceSchema,
  insertIndustrySchema, insertQueryClusterSchema, insertBlueprintSchema,
  insertPageSchema, insertGenerationJobSchema, onboardingSubmissions,
  websites, pages, trackedLeads,
} from "@shared/schema";
import { z } from "zod";
import { db } from "./db";
import { eq as dEq, and as dAnd, desc, like } from "drizzle-orm";
import { randomBytes } from "crypto";

// ── Cloudflare for SaaS custom hostname registration ─────────────────────────
// When a client domain is saved, auto-register it as a CF custom hostname so
// Cloudflare for SaaS routes their traffic to Nexus without any manual steps.

async function registerCFCustomHostname(domain: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !apiToken) {
    console.log(`[cf-hostname] Skipping registration for ${domain} — CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not set`);
    return { ok: false, error: "CF credentials not configured" };
  }
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        hostname: domain,
        ssl: { method: "http", type: "dv", settings: { http2: "on", min_tls_version: "1.2", tls_1_3: "on" } },
      }),
    });
    const json: any = await res.json();
    if (json.success) {
      console.log(`[cf-hostname] Registered ${domain} — status: ${json.result?.status}`);
      return { ok: true, status: json.result?.status };
    }
    const errCode = json.errors?.[0]?.code;
    // 1406 = hostname already exists — treat as success
    if (errCode === 1406) {
      console.log(`[cf-hostname] ${domain} already registered in CF for SaaS`);
      return { ok: true, status: "already_exists" };
    }
    console.error(`[cf-hostname] Failed to register ${domain}:`, json.errors);
    return { ok: false, error: json.errors?.[0]?.message ?? "CF API error" };
  } catch (err: any) {
    console.error(`[cf-hostname] Exception registering ${domain}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ── Sitemap chunk cache ───────────────────────────────────────────────────────
// Each child sitemap holds up to URLS_PER_SITEMAP (10K) URLs.
// Cache the built XML for 1 hour so Googlebot never times out on retry.
const sitemapChunkCache = new Map<string, { xml: string; expiresAt: number }>();
const SITEMAP_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export function invalidateSitemapCache(websiteId: string) {
  for (const key of sitemapChunkCache.keys()) {
    if (key.startsWith(websiteId + ":")) sitemapChunkCache.delete(key);
  }
}

// ── Published page HTML cache ─────────────────────────────────────────────────
// Caches the fully-rendered HTML for each slug so repeated requests (crawlers,
// multiple users) skip all 7 DB queries and return in <5 ms from memory.
// Also used for dynamically-generated pages (same key space, same TTL).
// SIZE-CAPPED: 1000 entries max. Pages average 200-400 KB each so
// 1000 entries ≈ 300 MB worst-case. Cloudflare edge cache absorbs the rest.
const pageHtmlCache = new Map<string, { html: string; expiresAt: number }>();
const PAGE_HTML_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — Cloudflare edge cache handles staleness
const PAGE_HTML_CACHE_MAX = 1000;

// Rate-limit fallback promotion checks to once per minute per website (avoids DB flood under crawler traffic)
const fallbackPromotionLastRun = new Map<string, number>();
const PAGE_HTML_CACHE_EVICT = 100; // evict oldest 100 when full (10% of 1000)

function pageHtmlCacheSet(key: string, value: { html: string; expiresAt: number }) {
  if (pageHtmlCache.size >= PAGE_HTML_CACHE_MAX) {
    // Map iteration order = insertion order — delete the oldest entries
    let evicted = 0;
    for (const k of pageHtmlCache.keys()) {
      pageHtmlCache.delete(k);
      if (++evicted >= PAGE_HTML_CACHE_EVICT) break;
    }
  }
  pageHtmlCache.set(key, value);
}

export function invalidatePageCache(websiteId: string, slug?: string) {
  if (slug) {
    pageHtmlCache.delete(`${websiteId}:${slug}`);
  } else {
    for (const key of pageHtmlCache.keys()) {
      if (key.startsWith(websiteId + ":")) pageHtmlCache.delete(key);
    }
  }
}

// ── Location resolution cache ─────────────────────────────────────────────────
// US cities and states never change — cache resolved location objects forever
// (server restart clears it, which is fine).
const locationCache = new Map<string, Awaited<ReturnType<typeof resolveLocationUncached>> | null>();

// ── Service banks cache ───────────────────────────────────────────────────────
// Variation banks change rarely; cache per website for 10 minutes.
const serviceBanksCache = new Map<string, { services: string[]; banksByService: Map<string, any[]>; expiresAt: number }>();
const SERVICE_BANKS_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function warmSitemapCache(websiteId: string): Promise<void> {
  try {
    const website = await storage.getWebsite(websiteId);
    if (!website) return;
    const sitemapList = await storage.getSitemaps(websiteId);
    if (sitemapList.length === 0) return;
    const { buildSitemapXml } = await import("./services/sitemap");
    for (let i = 0; i < sitemapList.length; i++) {
      const cacheKey = `${websiteId}:${i}`;
      // 1. Already warm in memory — done
      const cached = sitemapChunkCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        console.log(`[sitemap-warmup] chunk ${i + 1}/${sitemapList.length} already in memory for ${website.domain}`);
        continue;
      }
      // 2. Stored in DB — fast path (single row lookup, no 50K-page scan)
      const record = sitemapList[i];
      if (record?.xmlContent) {
        sitemapChunkCache.set(cacheKey, { xml: record.xmlContent, expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS });
        console.log(`[sitemap-warmup] chunk ${i + 1}/${sitemapList.length} loaded from DB for ${website.domain}`);
        continue;
      }
      // 3. Not stored yet — build from pages (slow, one-time cost) + persist to DB
      const offset = i * URLS_PER_SITEMAP;
      const chunk = await storage.getPages(websiteId, { status: "published", limit: URLS_PER_SITEMAP, offset });
      const baseUrl = `https://${website.domain}`;
      const urls = chunk.map((p) => ({
        loc: `${baseUrl}/${p.slug}`,
        lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0],
        priority: (p as any).pageType === "state_hub" ? "0.9" : (p as any).pageType === "city_hub" ? "0.8" : "0.7",
      }));
      const xml = buildSitemapXml(urls);
      sitemapChunkCache.set(cacheKey, { xml, expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS });
      await storage.updateSitemapXml(websiteId, record?.slug ?? `sitemap-${i + 1}`, xml).catch(() => {});
      console.log(`[sitemap-warmup] Built+stored chunk ${i + 1}/${sitemapList.length} for ${website.domain} (${urls.length} URLs)`);
    }
  } catch (err) {
    console.error(`[sitemap-warmup] Failed for ${websiteId}:`, err);
  }
}

function notFoundHtml(msg: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title>
  <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f9fa;}
  .box{text-align:center;padding:2rem;max-width:400px;}h1{color:#374151;}p{color:#6b7280;}</style></head>
  <body><div class="box"><h1>404</h1><p>${msg}</p></div></body></html>`;
}

interface NavData {
  statePages: { displayName: string; slug: string }[];
  cityPages: { displayName: string; slug: string }[];
  siblingServices: { title: string; slug: string; serviceName: string | null }[];
  stateDisplayName?: string;
  internalLinks?: { slug: string; anchorText: string; linkType: string }[];
}

async function resolveNavData(page: any, websiteId: string): Promise<[NavData["statePages"], NavData["cityPages"], string, NavData["siblingServices"]]> {
  // Extract service slug from current page slug (format: {service}-in-{location})
  const pageServiceSlug = page.slug && page.slug.includes("-in-")
    ? page.slug.slice(0, page.slug.lastIndexOf("-in-"))
    : undefined;

  // Kick off all independent queries in parallel
  const stateNavPromise = storage.getStateNavPages(websiteId, pageServiceSlug);
  const siblingPromise = ((page.pageType === "service_city" || page.pageType === "industry_city") && page.slug)
    ? storage.getSiblingServicePages(websiteId, page.slug, page.id, page.locationId ?? null)
    : Promise.resolve([] as NavData["siblingServices"]);

  let cityPagesPromise: Promise<NavData["cityPages"]> = Promise.resolve([]);
  let stateDisplayName = "";
  if (page.pageType === "state_hub") {
    const match = (page.title || "").match(/\bin\s+(.+?)(\s*\|.*)?$/i);
    if (match) {
      stateDisplayName = match[1].trim();
      cityPagesPromise = storage.getStateDataByName(stateDisplayName).then((stateEntry) =>
        stateEntry?.stateAbbr
          ? storage.getCityPagesForState(websiteId, stateEntry.stateAbbr)
          : []
      );
    }
  }

  const [statePages, siblingServices, cityPages] = await Promise.all([
    stateNavPromise,
    siblingPromise,
    cityPagesPromise,
  ]);

  return [statePages, cityPages, stateDisplayName, siblingServices];
}

const US_STATE_ABBRS = new Set([
  "al","ak","az","ar","ca","co","ct","de","dc","fl","ga","hi","id","il","in","ia","ks","ky","la",
  "me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok",
  "or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy",
]);

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function titleCase(slug: string): string {
  return slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Resolve location data from a location slug segment (handles both abbr and full-name formats)
async function resolveLocationUncached(locationSlug: string): Promise<{
  cityName: string; stateAbbr: string; stateName: string; locationType: "city" | "state"; stateData: any; canonicalCitySlug: string;
} | null> {
  // Abbreviation format: {city-slug}-{2-char-state}
  const abbrMatch = locationSlug.match(/^(.+)-([a-z]{2})$/);
  if (abbrMatch && US_STATE_ABBRS.has(abbrMatch[2])) {
    const stateData = await storage.getStateDataByAbbr(abbrMatch[2].toUpperCase());
    if (stateData) {
      return {
        cityName: titleCase(abbrMatch[1]),
        stateAbbr: stateData.stateAbbr,
        stateName: stateData.stateName,
        locationType: "city",
        stateData,
        canonicalCitySlug: abbrMatch[1],
      };
    }
  }
  // Full state name: check if it's a pure state slug
  const asName = titleCase(locationSlug);
  let stateData = await storage.getStateDataByName(asName);
  if (stateData) {
    return { cityName: stateData.stateName, stateAbbr: stateData.stateAbbr, stateName: stateData.stateName, locationType: "state", stateData, canonicalCitySlug: "" };
  }
  // Full name city format: {city-slug}-{full-state-slug}
  if (locationSlug.includes("-")) {
    const parts = locationSlug.split("-");
    for (let i = parts.length - 1; i >= 1; i--) {
      const stateCandidate = parts.slice(i).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      stateData = await storage.getStateDataByName(stateCandidate);
      if (stateData) {
        const citySlug = parts.slice(0, i).join("-");
        return {
          cityName: titleCase(citySlug),
          stateAbbr: stateData.stateAbbr,
          stateName: stateData.stateName,
          locationType: "city",
          stateData,
          canonicalCitySlug: citySlug,
        };
      }
    }
  }
  return null;
}

async function resolveLocation(locationSlug: string): Promise<Awaited<ReturnType<typeof resolveLocationUncached>>> {
  if (locationCache.has(locationSlug)) return locationCache.get(locationSlug)!;
  const result = await resolveLocationUncached(locationSlug);
  locationCache.set(locationSlug, result);
  return result;
}

// Find best matching service and its variation banks for a service slug (cached)
async function resolveServiceBanks(websiteId: string, serviceSlugFromUrl: string): Promise<{ serviceName: string; banks: any[] }> {
  // Populate / refresh the per-website service banks cache
  let siteCache = serviceBanksCache.get(websiteId);
  if (!siteCache || siteCache.expiresAt < Date.now()) {
    const bankServices = await storage.getVariationBankServices(websiteId);
    const banksByService = new Map<string, any[]>();
    await Promise.all(
      bankServices.map(async (s) => {
        const banks = await storage.getVariationBanks(websiteId, s);
        banksByService.set(s, banks);
      })
    );
    siteCache = { services: bankServices, banksByService, expiresAt: Date.now() + SERVICE_BANKS_TTL_MS };
    serviceBanksCache.set(websiteId, siteCache);
  }

  const { services: bankServices, banksByService } = siteCache;
  if (!bankServices.length) return { serviceName: titleCase(serviceSlugFromUrl), banks: [] };

  // 1. Exact slug match
  const exact = bankServices.find(s => slugify(s) === serviceSlugFromUrl);
  if (exact) {
    const banks = banksByService.get(exact) ?? [];
    if (banks.length) return { serviceName: exact, banks };
  }

  // 2. Best word-overlap match
  const urlWords = new Set(serviceSlugFromUrl.split("-").filter(w => w.length > 2));
  let bestScore = 0;
  let bestService = bankServices[0];
  for (const s of bankServices) {
    if (s.length > 120) continue;
    const sWords = slugify(s).split("-");
    const overlap = sWords.filter(w => urlWords.has(w)).length;
    if (overlap > bestScore) { bestScore = overlap; bestService = s; }
  }
  const fallbackService = bestScore > 0 ? bestService : bankServices.find(s => s.length <= 120) || bankServices[0];
  const banks = banksByService.get(fallbackService) ?? [];
  return { serviceName: titleCase(serviceSlugFromUrl), banks };
}

// Returns { html } to serve content or { redirect } to redirect, or null for true 404
async function tryGenerateDynamicPage(
  slug: string, website: any, brand: any, linkBase?: string,
): Promise<{ html: string } | { redirect: string } | null> {
  try {
    // Hard limit: never dynamically generate pages with very long slugs
    if (slug.length > 200) return null;

    // Parse: try "{service}-in-{location}" first, then fall back to "{service}-{location}"
    let serviceSlugFromUrl: string;
    let locationSlug: string;

    const inIdx = slug.lastIndexOf("-in-");
    if (inIdx >= 1) {
      serviceSlugFromUrl = slug.slice(0, inIdx);
      locationSlug = slug.slice(inIdx + 4);
    } else {
      // Blueprint format: "{service}-{location}" (no "-in-" separator).
      // Try progressively longer trailing segments as the location slug,
      // shortest first (state-only), then longer (city-state).
      const parts = slug.split("-");
      let resolved: Awaited<ReturnType<typeof resolveLocation>> = null;
      let resolvedServiceSlug = "";
      let resolvedLocationSlug = "";
      for (let i = parts.length - 1; i >= 1; i--) {
        const candidateLoc = parts.slice(i).join("-");
        const candidateSvc = parts.slice(0, i).join("-");
        if (!candidateSvc) continue;
        const loc = await resolveLocation(candidateLoc);
        if (loc) {
          // Prefer city matches over state-only matches (longer location slug wins)
          if (!resolved || (loc.locationType === "city" && resolved.locationType === "state")) {
            resolved = loc;
            resolvedServiceSlug = candidateSvc;
            resolvedLocationSlug = candidateLoc;
          }
          // Once we have a city match stop searching further
          if (resolved.locationType === "city") break;
        }
      }
      if (!resolved) return null;
      serviceSlugFromUrl = resolvedServiceSlug;
      locationSlug = resolvedLocationSlug;
    }

    if (!serviceSlugFromUrl || !locationSlug) return null;

    // Sanitize proxyPath: admin-preview paths (starting with /sites/) must never be used for live page links
    const rawSettingsProxy = ((website.settings as any)?.proxyPath || "") as string;
    const proxyPath = linkBase ?? (rawSettingsProxy.startsWith("/sites/") ? "" : rawSettingsProxy);

    // ── Step 1: resolve location ──────────────────────────────────────────────
    const loc = await resolveLocation(locationSlug);
    if (!loc) return null; // Not a recognisable US location → true 404

    // ── Step 2: if abbreviation format, try to redirect to canonical full-name ─
    if (loc.locationType === "city") {
      const fullNameSlug = `${serviceSlugFromUrl}-in-${loc.canonicalCitySlug}-${slugify(loc.stateName)}`;
      if (fullNameSlug !== slug) {
        const existing = await storage.getPageBySlug(website.id, fullNameSlug);
        if (existing?.status === "published") {
          return { redirect: `${proxyPath}/${fullNameSlug}` };
        }
      }
    }

    // ── Step 3: find or fall back to best service banks ───────────────────────
    const { serviceName, banks } = await resolveServiceBanks(website.id, serviceSlugFromUrl);

    const brandName = brand?.name || website.name || website.domain;
    const locationName = loc.locationType === "city" ? loc.cityName : loc.stateName;
    const canonicalSlug = loc.locationType === "city"
      ? `${serviceSlugFromUrl}-in-${loc.canonicalCitySlug}-${slugify(loc.stateName)}`
      : slug;

    let contentHtml: string;
    let title: string;
    let h1: string;
    let metaDescription: string;

    if (banks.length) {
      const result = buildVariationPage(
        serviceName, serviceSlugFromUrl, locationName, loc.locationType,
        loc.stateName, loc.stateAbbr, brandName, banks, loc.stateData,
        null, undefined, undefined, website.domain, undefined, proxyPath,
      );
      contentHtml = result.contentHtml;
      title = result.title;
      h1 = result.h1;
      metaDescription = result.metaDescription;
    } else {
      // No banks at all — build a clean minimal page from scratch
      const loc2 = loc.locationType === "city" ? `${locationName}, ${loc.stateAbbr}` : loc.stateName;
      title = `${serviceName} in ${loc2} | ${brandName}`;
      h1 = `${serviceName} in ${loc2}`;
      metaDescription = `${brandName} provides ${serviceName} to businesses in ${loc2}. Contact us today to learn how we can help.`;
      contentHtml = `<p>Looking for <strong>${serviceName}</strong> in ${loc2}? <strong>${brandName}</strong> serves local businesses with professional solutions. Contact us today to get started.</p>`;
    }

    const syntheticPage = {
      id: "dynamic-" + canonicalSlug,
      slug: canonicalSlug !== slug ? canonicalSlug : slug,
      title, h1, metaDescription,
      pageType: loc.locationType === "city" ? "service_city" : "state_hub",
      websiteId: website.id, status: "published",
      publishedAt: new Date(), updatedAt: new Date(),
      tier: 2,
      _noindex: true,
    };

    // Log fallback hit (fire-and-forget — never block page rendering)
    storage.logFallbackHit(website.id, slug).catch(() => {});

    // Auto 5: Check if this fallback URL has crossed the promotion threshold
    // Rate-limited to once per minute per website to avoid DB saturation under crawler traffic
    const now = Date.now();
    const lastCheck = fallbackPromotionLastRun.get(website.id) ?? 0;
    if (now - lastCheck > 60_000) {
      fallbackPromotionLastRun.set(website.id, now);
      setImmediate(async () => {
        try {
          const { checkFallbackPromotion, getAutomationSettings } = await import("./services/automation");
          const autoSettings = getAutomationSettings(website);
          await checkFallbackPromotion(website.id, slug, autoSettings);
        } catch { /* never block */ }
      });
    }

    const [statePages, cityPages, stateDisplayName, siblingServices] = await resolveNavData(syntheticPage, website.id);
    const html = renderPageHtml(syntheticPage, { contentHtml }, website, brand, { statePages, cityPages, stateDisplayName, siblingServices }, proxyPath || undefined);

    // Cache the rendered HTML so the next request for this slug is instant
    pageHtmlCacheSet(`${website.id}:${slug}`, { html, expiresAt: Date.now() + PAGE_HTML_CACHE_TTL_MS });

    console.log(`[dynamic-page] 200 generated: ${slug} → svc="${serviceName}" loc="${locationName}"`);
    return { html };

  } catch (err) {
    console.error("[dynamic-page] error for slug", slug, err);
    return null;
  }
}

function extractFaqSchema(contentHtml: string, pageUrl: string): string | null {
  const faqIdx = contentHtml.search(/Frequently Asked Questions/i);
  if (faqIdx === -1) return null;
  const faqSection = contentHtml.slice(faqIdx);
  const qaPattern = /<(?:h3|dt)[^>]*>([\s\S]*?)<\/(?:h3|dt)>\s*<(?:p|dd)[^>]*>([\s\S]*?)<\/(?:p|dd)>/gi;
  const items: { q: string; a: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = qaPattern.exec(faqSection)) !== null && items.length < 10) {
    const q = m[1].replace(/<[^>]+>/g, "").trim();
    const a = m[2].replace(/<[^>]+>/g, "").trim();
    if (q && a && q.length > 5) items.push({ q, a });
  }
  if (items.length === 0) return null;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": items.map(({ q, a }) => ({
      "@type": "Question",
      "name": q,
      "acceptedAnswer": { "@type": "Answer", "text": a },
    })),
  });
}

function renderPageHtml(page: any, version: any, website: any, brand: any, navData: NavData = { statePages: [], cityPages: [], siblingServices: [] }, linkBaseOverride?: string): string {
  const brandName = brand?.name || website.name || website.domain;
  const primaryColor = brand?.primaryColor || "#2563eb";

  // ✅ CHANGED: read brand profile override fields first, fall back to website.settings, then system defaults.
  // 🔒 UNTOUCHED: all other variable resolution, HTML structure, nav logic, schema.org, caching unchanged.
  const phone = brand?.phoneOverride || brand?.phone || (website.settings as any)?.phone || "";
  const tagline = brand?.tagline || (website.settings as any)?.tagline || "";
  const rawMainUrl = brand?.websiteUrl || (website.settings as any)?.mainWebsiteUrl || brand?.customFields?.websiteUrl || "";
  const mainWebsiteUrl = rawMainUrl && !/^https?:\/\//i.test(rawMainUrl) ? `https://${rawMainUrl}` : rawMainUrl;
  const ctaHeading = brand?.ctaHeading || (website.settings as any)?.ctaHeading || `Visit ${brandName}`;
  const ctaText = brand?.ctaBody || (website.settings as any)?.ctaText || "See how we can help your business grow.";
  const ctaButtonLabel = brand?.ctaButtonLabel || (website.settings as any)?.ctaButtonLabel || "Learn More";
  const demoBannerUrl = brand?.demoBannerUrl || (website.settings as any)?.demoBannerUrl || "";
  const demoBannerHeading = brand?.demoBannerHeading || (website.settings as any)?.demoBannerHeading || "See This Platform in Action";
  const demoBannerSubtext = brand?.demoBannerSubtext || (website.settings as any)?.demoBannerSubtext || "This page was generated automatically. Want 100,000+ pages like it for your business?";
  const demoBannerButtonLabel = brand?.demoBannerButton || (website.settings as any)?.demoBannerButtonLabel || "Try the Live Demo →";

  const parentDomain = (website.settings as any)?.parentDomain;
  const rawSettingsProxy = ((website.settings as any)?.proxyPath ?? "") as string;
  // Sanitize: admin-preview paths (starting with /sites/) must never leak into live page rendering
  const sanitizedProxy = rawSettingsProxy.startsWith("/sites/") ? "" : rawSettingsProxy;
  const proxyPath = linkBaseOverride ?? sanitizedProxy;
  console.log(`[render] slug=${page.slug} rawProxy=${JSON.stringify(rawSettingsProxy)} linkBaseOverride=${JSON.stringify(linkBaseOverride)} proxyPath=${JSON.stringify(proxyPath)}`);
  const canonicalBase = parentDomain ? `https://${parentDomain}${sanitizedProxy}` : `https://${website.domain}`;
  const pageUrl = `${canonicalBase}/${page.slug}`;
  const baseUrl = canonicalBase;

  // Extract service name and location from title (e.g. "Merchant Services in Dallas, TX | Brand")
  const safeTitle = page.title || page.slug || "";
  const titleMatch = safeTitle.match(/^(.+?)\s+in\s+(.+?)(?:\s*\|.*)?$/i);
  const serviceNameFromTitle = titleMatch ? titleMatch[1].trim() : brandName;
  const locationFromTitle = titleMatch ? titleMatch[2].trim() : "";

  // ── Schema: LocalBusiness + Service ───────────────────────────────────────
  const localBusinessSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["LocalBusiness", "FinancialService"],
        "@id": `${baseUrl}/#business`,
        "name": brandName,
        "url": mainWebsiteUrl || baseUrl,
        ...(phone ? { "telephone": phone } : {}),
        "areaServed": locationFromTitle || undefined,
        "description": page.metaDescription || undefined,
        "sameAs": mainWebsiteUrl ? [mainWebsiteUrl] : [],
      },
      {
        "@type": "Service",
        "name": serviceNameFromTitle,
        "provider": { "@id": `${baseUrl}/#business` },
        "areaServed": locationFromTitle || undefined,
        "url": pageUrl,
        "description": page.metaDescription || undefined,
      },
    ],
  });

  // ── Schema: BreadcrumbList ────────────────────────────────────────────────
  const breadcrumbItems: any[] = [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": baseUrl },
  ];
  if (locationFromTitle) {
    breadcrumbItems.push({ "@type": "ListItem", "position": 2, "name": serviceNameFromTitle, "item": pageUrl });
    breadcrumbItems.push({ "@type": "ListItem", "position": 3, "name": locationFromTitle, "item": pageUrl });
  } else {
    breadcrumbItems.push({ "@type": "ListItem", "position": 2, "name": page.h1 || page.title, "item": pageUrl });
  }
  const breadcrumbSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": breadcrumbItems,
  });

  // ── Schema: FAQPage (extracted from content HTML) ─────────────────────────
  const faqSchema = extractFaqSchema(version?.contentHtml || "", pageUrl);

  const pageTier: number = (page as any).tier ?? 2;
  const isNoindex: boolean = pageTier === 3 || (page as any)._noindex === true;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${page.title}</title>
  <meta name="description" content="${(page.metaDescription || "").replace(/"/g, "&quot;")}" />
  <link rel="canonical" href="${pageUrl}" />
  ${isNoindex ? '<meta name="robots" content="noindex,nofollow" />' : '<meta name="robots" content="index,follow" />'}
  <meta property="og:title" content="${page.title}" />
  <meta property="og:description" content="${(page.metaDescription || "").replace(/"/g, "&quot;")}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:site_name" content="${brandName}" />
  <meta property="og:locale" content="en_US" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${page.title}" />
  <meta name="twitter:description" content="${(page.metaDescription || "").replace(/"/g, "&quot;")}" />
  <script type="application/ld+json">${localBusinessSchema}</script>
  <script type="application/ld+json">${breadcrumbSchema}</script>
  ${faqSchema ? `<script type="application/ld+json">${faqSchema}</script>` : ""}
  ${website.domain === "pages.spotonresults.com" ? `<!-- Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-VH980NTHCM"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-VH980NTHCM');
  </script>` : ""}
  ${website.domain === "pagessubtrackers.spotonresults.com" ? `<!-- Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-GY5VTKVQ88"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-GY5VTKVQ88');
  </script>` : ""}
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2937;line-height:1.6}
    a{color:${primaryColor};text-decoration:none}
    a:hover{text-decoration:underline}
    header{background:${primaryColor};color:#fff;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem}
    header .brand{font-size:1.25rem;font-weight:700;color:#fff;text-decoration:none}
    header .brand:hover{text-decoration:underline;color:#fff}
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
    .contact-section{background:#f8fafc;border-radius:.75rem;padding:2rem;margin:2.5rem 0;border:1px solid #e2e8f0}
    .contact-section>h2{font-size:1.35rem;font-weight:700;color:#111827;margin-bottom:.5rem;border:none}
    .contact-section>.sub{color:#6b7280;margin-bottom:1.25rem}
    .cta-link{margin-bottom:1.25rem}
    .form-row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
    @media(max-width:600px){.form-row{grid-template-columns:1fr}}
    .form-group{margin-bottom:1rem}
    label{display:block;font-size:.875rem;font-weight:600;color:#374151;margin-bottom:.35rem}
    input[type=text],input[type=email],input[type=tel],textarea{width:100%;padding:.6rem .75rem;border:1px solid #d1d5db;border-radius:.5rem;font-size:.95rem;color:#1f2937;font-family:inherit;background:#fff;outline:none;transition:border-color .15s;box-sizing:border-box}
    input:focus,textarea:focus{border-color:${primaryColor};box-shadow:0 0 0 3px ${primaryColor}33}
    textarea{resize:vertical}
    #submitBtn{background:${primaryColor};color:#fff;border:none;padding:.75rem 2rem;border-radius:.5rem;font-size:1rem;font-weight:700;cursor:pointer;margin-top:.5rem;width:100%}
    #submitBtn:hover{opacity:.9}
    #submitBtn:disabled{opacity:.6;cursor:not-allowed}
    .loc-nav{border-top:2px solid #e5e7eb;padding:2rem 0;margin-top:2rem}
    .loc-nav-title{font-size:1rem;font-weight:700;color:#374151;margin-bottom:1rem;text-transform:uppercase;letter-spacing:.05em;font-size:.85rem}
    .loc-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:.4rem}
    @media(max-width:768px){.loc-grid{grid-template-columns:repeat(3,1fr)}}
    @media(max-width:480px){.loc-grid{grid-template-columns:repeat(2,1fr)}}
    .loc-grid a{display:block;padding:.4rem .6rem;font-size:.85rem;color:#4b5563;border:1px solid #e5e7eb;border-radius:.375rem;text-decoration:none;transition:all .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .loc-grid a:hover{background:${primaryColor}10;border-color:${primaryColor}40;color:${primaryColor};text-decoration:none}
    .breadcrumb{font-size:.85rem;color:rgba(255,255,255,.75);margin-bottom:.75rem;display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
    .breadcrumb a{color:rgba(255,255,255,.85);text-decoration:none}.breadcrumb a:hover{color:#fff;text-decoration:underline}
    .bc-sep{color:rgba(255,255,255,.5);font-size:.9rem}
    footer{background:#f9fafb;border-top:1px solid #e5e7eb;padding:1.5rem 2rem;text-align:center;color:#9ca3af;font-size:.85rem;margin-top:3rem}
    .demo-banner{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:#fff;padding:2.5rem 2rem;text-align:center;border-bottom:4px solid ${primaryColor}}
    .demo-banner h2{font-size:1.6rem;font-weight:800;margin-bottom:.6rem;color:#fff}
    .demo-banner p{color:#cbd5e1;font-size:1rem;margin-bottom:1.5rem;max-width:600px;margin-left:auto;margin-right:auto}
    .demo-banner a.demo-btn{display:inline-block;background:${primaryColor};color:#fff;font-weight:700;font-size:1.1rem;padding:.9rem 2.5rem;border-radius:.6rem;text-decoration:none;letter-spacing:.02em;transition:opacity .15s;box-shadow:0 4px 14px rgba(0,0,0,.3)}
    .demo-banner a.demo-btn:hover{opacity:.88;text-decoration:none}
    .demo-banner .badge{display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);color:#e2e8f0;font-size:.75rem;font-weight:600;padding:.25rem .75rem;border-radius:999px;margin-bottom:1rem;letter-spacing:.04em;text-transform:uppercase}
  </style>
</head>
<body>
  <header>
    ${mainWebsiteUrl
      ? `<a href="${mainWebsiteUrl}" class="brand" target="_blank" rel="noopener">${brandName}</a>`
      : `<span class="brand">${brandName}</span>`}
    ${phone ? `<a href="tel:${phone.replace(/\D/g, "")}" class="phone">${phone}</a>` : ""}
  </header>

  ${demoBannerUrl ? `
  <div class="demo-banner">
    <div class="badge">Powered by Nexus Pages</div>
    <h2>${demoBannerHeading}</h2>
    <p>${demoBannerSubtext}</p>
    <a href="${demoBannerUrl}" class="demo-btn" target="_blank" rel="noopener">${demoBannerButtonLabel}</a>
  </div>` : ""}

  <div class="hero">
    ${locationFromTitle ? `<nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="${baseUrl}">Home</a>
      <span class="bc-sep">›</span>
      <span>${serviceNameFromTitle}</span>
      <span class="bc-sep">›</span>
      <span>${locationFromTitle}</span>
    </nav>` : ""}
    <h1>${page.h1 || page.title}</h1>
    ${tagline ? `<p class="tagline">${tagline}</p>` : ""}
  </div>

  <main>
    ${(version?.contentHtml || "<p>Content coming soon.</p>")
      // Remove links whose href is longer than 200 chars (bad long-slug service links)
      .replace(/<li[^>]*>\s*<a\s+href="[^"]{200,}"[^>]*>[^<]*<\/a>\s*<\/li>\n?/g, "")
      // Strip " in City, ST" from service link text in Related Services lists
      .replace(/(<a\s[^>]*>)([^<]+?)\s+in\s+[A-Za-z\s.''-]+,\s+[A-Z]{2}(<\/a>)/g,
        (_, open, name, close) => `${open}${name.trim()}${close}`)
      // On live domain: strip stale link prefixes baked into older published content.
      // Handle all three forms the content may have been stored with:
      //   1. absolute + /sites/: href="https://sub.domain.com/sites/sub.domain.com/pages/slug"
      //   2. absolute root:       href="https://sub.domain.com/pages/slug"
      //   3. relative /sites/:   href="/sites/sub.domain.com/pages/slug"
      .replace(
        (linkBaseOverride && !linkBaseOverride.startsWith('/sites/'))
          ? new RegExp('href="https://' + website.domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/sites/' + website.domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/', 'g')
          : /$^/,
        'href="/'
      )
      .replace(
        (linkBaseOverride && !linkBaseOverride.startsWith('/sites/'))
          ? new RegExp('href="https://' + website.domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/', 'g')
          : /$^/,
        'href="/'
      )
      .replace(
        (linkBaseOverride && !linkBaseOverride.startsWith('/sites/'))
          ? new RegExp('href="/sites/' + website.domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/', 'g')
          : /$^/,
        'href="/'
      )
    }
    ${(linkBaseOverride && linkBaseOverride.startsWith('/sites/')) ? `<script>
    // Rewrite root-relative body links to use the correct path prefix (admin preview only).
    // Strip any stored proxyPath prefix (e.g. /pages) first so content links like
    // href="/pages/slug" become href="/sites/domain/slug" — not /sites/domain/pages/slug.
    (function(){
      var base = ${JSON.stringify(linkBaseOverride)};
      var px = ${JSON.stringify(rawSettingsProxy.startsWith('/sites/') ? '' : rawSettingsProxy)};
      document.querySelectorAll('main a[href^="/"]').forEach(function(a){
        var h = a.getAttribute('href');
        if (!h.startsWith(base)) {
          if (px && h.startsWith(px + '/')) h = h.slice(px.length);
          a.setAttribute('href', base + h);
        }
      });
    })();
    </script>` : ""}
    ${(!linkBaseOverride && rawSettingsProxy.startsWith('/sites/')) ? `<script>
    // Strip stale /sites/{domain} prefix baked into stored page content (live-site cleanup)
    (function(){
      var p = ${JSON.stringify(rawSettingsProxy)};
      document.querySelectorAll('main a[href]').forEach(function(a){
        var h = a.getAttribute('href');
        if (h && h.startsWith(p + '/')) a.setAttribute('href', h.slice(p.length));
      });
    })();
    </script>` : ""}
    ${(linkBaseOverride && !linkBaseOverride.startsWith('/sites/')) ? `<script>
    // Strip stale /sites/{domain} prefix baked into older published content when serving on live domain
    (function(){
      var prefix = '/sites/' + ${JSON.stringify(website.domain)};
      document.querySelectorAll('main a[href^="/sites/"]').forEach(function(a){
        var h = a.getAttribute('href');
        if (h.startsWith(prefix)) a.setAttribute('href', h.slice(prefix.length));
      });
    })();
    </script>` : ""}

    <div class="contact-section">
      <h2>${ctaHeading}</h2>
      <p class="sub">${ctaText}</p>
      ${mainWebsiteUrl ? `<p class="cta-link"><a href="${mainWebsiteUrl}" target="_blank" rel="noopener">Visit ${brandName} →</a></p>` : ""}
      <form id="contactForm">
        <div class="form-group">
          <label for="cf-name">Your Name *</label>
          <input type="text" id="cf-name" required placeholder="Jane Smith" />
        </div>
        <div class="form-group">
          <label for="cf-biz">Business Name</label>
          <input type="text" id="cf-biz" placeholder="Acme LLC" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="cf-email">Email Address *</label>
            <input type="email" id="cf-email" required placeholder="jane@example.com" />
          </div>
          <div class="form-group">
            <label for="cf-phone">Phone Number</label>
            <input type="tel" id="cf-phone" placeholder="(555) 123-4567" />
          </div>
        </div>
        <div class="form-group">
          <label for="cf-msg">Message (optional)</label>
          <textarea id="cf-msg" rows="3" placeholder="Tell us about your business..."></textarea>
        </div>
        <button type="submit" id="submitBtn">${ctaButtonLabel}</button>
        <div id="formStatus" style="display:none;margin-top:1rem;padding:.75rem 1rem;border-radius:.5rem;font-weight:600;text-align:center"></div>
      </form>
    </div>
  </main>
  <script>
    document.getElementById('contactForm').addEventListener('submit', function(e) {
      e.preventDefault();
      var btn = document.getElementById('submitBtn');
      var status = document.getElementById('formStatus');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      var controller = new AbortController();
      var timer = setTimeout(function() { controller.abort(); }, 15000);
      fetch('/api/public/contact', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        signal: controller.signal,
        body: JSON.stringify({
          websiteId: '${page.websiteId}',
          pageId: '${page.id}',
          pageSlug: '${page.slug}',
          name: document.getElementById('cf-name').value,
          businessName: document.getElementById('cf-biz').value,
          email: document.getElementById('cf-email').value,
          phone: document.getElementById('cf-phone').value,
          message: document.getElementById('cf-msg').value
        })
      }).then(function(r){ clearTimeout(timer); return r.json(); }).then(function(data){
        if (data.success) {
          document.getElementById('contactForm').style.display = 'none';
          status.style.display = 'block';
          status.style.background = '#d1fae5';
          status.style.color = '#065f46';
          status.textContent = 'Thank you! We will be in touch shortly.';
        } else {
          status.style.display = 'block';
          status.style.background = '#fee2e2';
          status.style.color = '#991b1b';
          status.textContent = data.message || 'Something went wrong. Please try again.';
          btn.disabled = false;
          btn.textContent = '${ctaButtonLabel}';
        }
      }).catch(function(err){
        clearTimeout(timer);
        status.style.display = 'block';
        status.style.background = '#fee2e2';
        status.style.color = '#991b1b';
        status.textContent = (err && err.name === 'AbortError')
          ? 'Request timed out. Please try again.'
          : 'Connection error. Please try again.';
        btn.disabled = false;
        btn.textContent = '${ctaButtonLabel}';
      });
    });
  </script>

  ${(() => {
    // Split stored internal links by type so each section is purpose-built
    const allLinks = navData.internalLinks ?? [];
    const crossServiceLinks = allLinks.filter(l => l.linkType === "cross-service");
    const hubToCityLinks    = allLinks.filter(l => l.linkType === "hub-to-city");
    // state-nav links are deliberately omitted — "Explore All Locations" already covers them

    // "More Services" — prefer live sibling query; fall back to stored cross-service links
    const siblings = navData.siblingServices ?? [];
    const moreServicesItems: { label: string; slug: string }[] = siblings.length > 0
      ? siblings.map(p => ({
          label: p.serviceName ?? p.title.replace(/\s+in\s+.+$/i, "").replace(/\s*\|.*$/, "").trim(),
          slug: p.slug,
        }))
      : crossServiceLinks.map(l => ({ label: l.anchorText, slug: l.slug }));

    const sections: string[] = [];

    if (moreServicesItems.length > 0) {
      sections.push(`
  <div style="max-width:900px;margin:0 auto;padding:0 1.5rem">
    <div class="loc-nav">
      <div class="loc-nav-title">More Services${locationFromTitle ? ` in ${locationFromTitle}` : ""}</div>
      <div class="loc-grid">
        ${moreServicesItems.map(p => `<a href="${proxyPath}/${p.slug}">${p.label}</a>`).join("\n        ")}
      </div>
    </div>
  </div>`);
    }

    if (navData.cityPages.length > 0) {
      sections.push(`
  <div style="max-width:900px;margin:0 auto;padding:0 1.5rem">
    <div class="loc-nav">
      <div class="loc-nav-title">Cities in ${navData.stateDisplayName || "this state"}</div>
      <div class="loc-grid">
        ${navData.cityPages.map(p => `<a href="${proxyPath}/${p.slug}">${p.displayName}</a>`).join("\n        ")}
      </div>
    </div>
  </div>`);
    } else if (hubToCityLinks.length > 0) {
      // On state_hub pages with no live cityPages yet — use stored hub-to-city links
      sections.push(`
  <div style="max-width:900px;margin:0 auto;padding:0 1.5rem">
    <div class="loc-nav">
      <div class="loc-nav-title">Cities We Serve</div>
      <div class="loc-grid">
        ${hubToCityLinks.map(l => `<a href="${proxyPath}/${l.slug}">${l.anchorText}</a>`).join("\n        ")}
      </div>
    </div>
  </div>`);
    }

    if (navData.statePages.length > 0) {
      sections.push(`
  <div style="max-width:900px;margin:0 auto;padding:0 1.5rem">
    <div class="loc-nav">
      <div class="loc-nav-title">Explore All Locations</div>
      <div class="loc-grid">
        ${navData.statePages.map(p => `<a href="${proxyPath}/${p.slug}">${p.displayName}</a>`).join("\n        ")}
      </div>
    </div>
  </div>`);
    }

    return sections.join("\n");
  })()}

  <footer>
    &copy; ${new Date().getFullYear()} ${mainWebsiteUrl
      ? `<a href="${mainWebsiteUrl}" target="_blank" rel="noopener" style="color:#9ca3af">${brandName}</a>`
      : brandName}. All rights reserved.
    ${phone ? ` &bull; <a href="tel:${phone.replace(/\D/g, "")}" style="color:#9ca3af">${phone}</a>` : ""}
    ${mainWebsiteUrl ? ` &bull; <a href="${mainWebsiteUrl}" target="_blank" rel="noopener" style="color:#9ca3af">${mainWebsiteUrl.replace(/^https?:\/\//, "")}</a>` : ""}
  </footer>
</body>
</html>`;
}

// ── registerRoutes ────────────────────────────────────────────────────────────
// All route registration has been moved to server/routes/ sub-routers, which
// are mounted by mountSubRouters() in index.ts. This stub satisfies the import
// contract in index.ts without registering any duplicate routes.
// ✅ CHANGED: added missing export that index.ts requires
export async function registerRoutes(server: Server, app: Express): Promise<Server> {
  return server;
}
