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
  websites, pages,
} from "@shared/schema";
import { z } from "zod";
import { db } from "./db";
import { eq as dEq, desc, like } from "drizzle-orm";
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
  const statePages = await storage.getStateNavPages(websiteId, pageServiceSlug);
  let cityPages: NavData["cityPages"] = [];
  let stateDisplayName = "";
  let siblingServices: NavData["siblingServices"] = [];

  if (page.pageType === "state_hub") {
    const match = page.title.match(/\bin\s+(.+?)(\s*\|.*)?$/i);
    if (match) {
      stateDisplayName = match[1].trim();
      const stateEntry = await storage.getStateDataByName(stateDisplayName);
      if (stateEntry?.stateAbbr) {
        cityPages = await storage.getCityPagesForState(websiteId, stateEntry.stateAbbr);
      }
    }
  }

  if (page.pageType === "service_city" && page.slug) {
    siblingServices = await storage.getSiblingServicePages(websiteId, page.slug, page.id);
  }

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
async function resolveLocation(locationSlug: string): Promise<{
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

// Find best matching service and its variation banks for a service slug
async function resolveServiceBanks(websiteId: string, serviceSlugFromUrl: string): Promise<{ serviceName: string; banks: any[] }> {
  const bankServices = await storage.getVariationBankServices(websiteId);
  if (!bankServices.length) return { serviceName: titleCase(serviceSlugFromUrl), banks: [] };

  // 1. Exact slug match
  const exact = bankServices.find(s => slugify(s) === serviceSlugFromUrl);
  if (exact) {
    const banks = await storage.getVariationBanks(websiteId, exact);
    if (banks.length) return { serviceName: exact, banks };
  }

  // 2. Best word-overlap match
  const urlWords = new Set(serviceSlugFromUrl.split("-").filter(w => w.length > 2));
  let bestScore = 0;
  let bestService = bankServices[0];
  for (const s of bankServices) {
    if (s.length > 120) continue; // skip bad/long service names
    const sWords = slugify(s).split("-");
    const overlap = sWords.filter(w => urlWords.has(w)).length;
    if (overlap > bestScore) { bestScore = overlap; bestService = s; }
  }
  // Use best match even if score is 0 (fall back to first valid service)
  const fallbackService = bestScore > 0 ? bestService : bankServices.find(s => s.length <= 120) || bankServices[0];
  const banks = await storage.getVariationBanks(websiteId, fallbackService);
  return { serviceName: titleCase(serviceSlugFromUrl), banks };
}

// Returns { html } to serve content or { redirect } to redirect, or null for true 404
async function tryGenerateDynamicPage(
  slug: string, website: any, brand: any, linkBase?: string,
): Promise<{ html: string } | { redirect: string } | null> {
  try {
    // Hard limit: never dynamically generate pages with very long slugs
    if (slug.length > 200) return null;

    const inIdx = slug.lastIndexOf("-in-");
    if (inIdx < 1) return null;

    const serviceSlugFromUrl = slug.slice(0, inIdx);
    const locationSlug = slug.slice(inIdx + 4);
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
    setImmediate(async () => {
      try {
        const { checkFallbackPromotion, getAutomationSettings } = await import("./services/automation");
        const autoSettings = getAutomationSettings(website);
        await checkFallbackPromotion(website.id, slug, autoSettings);
      } catch { /* never block */ }
    });

    const [statePages, cityPages, stateDisplayName, siblingServices] = await resolveNavData(syntheticPage, website.id);
    console.log(`[dynamic-page] 200 generated: ${slug} → svc="${serviceName}" loc="${locationName}"`);
    return { html: renderPageHtml(syntheticPage, { contentHtml }, website, brand, { statePages, cityPages, stateDisplayName, siblingServices }, proxyPath || undefined) };

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
  const phone = brand?.phone || (website.settings as any)?.phone || "";
  const tagline = brand?.tagline || (website.settings as any)?.tagline || "";
  const rawMainUrl = (website.settings as any)?.mainWebsiteUrl || brand?.customFields?.websiteUrl || "";
  const mainWebsiteUrl = rawMainUrl && !/^https?:\/\//i.test(rawMainUrl) ? `https://${rawMainUrl}` : rawMainUrl;
  const ctaHeading = (website.settings as any)?.ctaHeading || `Visit ${brandName}`;
  const ctaText = (website.settings as any)?.ctaText || "See how we can help your business grow.";
  const ctaButtonLabel = (website.settings as any)?.ctaButtonLabel || "Learn More";
  const demoBannerUrl = (website.settings as any)?.demoBannerUrl || "";
  const demoBannerHeading = (website.settings as any)?.demoBannerHeading || "See This Platform in Action";
  const demoBannerSubtext = (website.settings as any)?.demoBannerSubtext || "This page was generated automatically. Want 100,000+ pages like it for your business?";
  const demoBannerButtonLabel = (website.settings as any)?.demoBannerButtonLabel || "Try the Live Demo →";

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
  const titleMatch = page.title.match(/^(.+?)\s+in\s+(.+?)(?:\s*\|.*)?$/i);
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
      fetch('/api/public/contact', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
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
      }).then(function(r){ return r.json(); }).then(function(data){
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
      }).catch(function(){
        status.style.display = 'block';
        status.style.background = '#fee2e2';
        status.style.color = '#991b1b';
        status.textContent = 'Connection error. Please try again.';
        btn.disabled = false;
        btn.textContent = '${ctaButtonLabel}';
      });
    });
  </script>

  ${(navData.siblingServices ?? []).length > 0 ? `
  <div style="max-width:900px;margin:0 auto;padding:0 1.5rem">
    <div class="loc-nav">
      <div class="loc-nav-title">More Services${locationFromTitle ? ` in ${locationFromTitle}` : ""}</div>
      <div class="loc-grid">
        ${(navData.siblingServices ?? []).map(p => {
          const svcName = p.serviceName ?? p.title.replace(/\s+in\s+.+$/i, "").replace(/\s*\|.*$/, "").trim();
          return `<a href="${proxyPath}/${p.slug}">${svcName}</a>`;
        }).join("\n        ")}
      </div>
    </div>
  </div>` : ""}

  ${navData.cityPages.length > 0 ? `
  <div style="max-width:900px;margin:0 auto;padding:0 1.5rem">
    <div class="loc-nav">
      <div class="loc-nav-title">Cities in ${navData.stateDisplayName || "this state"}</div>
      <div class="loc-grid">
        ${navData.cityPages.map(p => `<a href="${proxyPath}/${p.slug}">${p.displayName}</a>`).join("\n        ")}
      </div>
    </div>
  </div>` : ""}

  ${navData.statePages.length > 0 ? `
  <div style="max-width:900px;margin:0 auto;padding:0 1.5rem">
    <div class="loc-nav">
      <div class="loc-nav-title">Explore All Locations</div>
      <div class="loc-grid">
        ${navData.statePages.map(p => `<a href="${proxyPath}/${p.slug}">${p.displayName}</a>`).join("\n        ")}
      </div>
    </div>
  </div>` : ""}

  ${(navData.internalLinks ?? []).length > 0 ? `
  <div style="max-width:900px;margin:0 auto;padding:0 1.5rem">
    <div class="loc-nav">
      <div class="loc-nav-title">Related Pages</div>
      <div class="loc-grid">
        ${(navData.internalLinks ?? []).map(l => `<a href="${proxyPath}/${l.slug}">${l.anchorText}</a>`).join("\n        ")}
      </div>
    </div>
  </div>` : ""}

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

  // Temporary debug endpoint — remove after diagnosing CF for SaaS headers
  app.get("/cf-debug", (req: Request, res: Response) => {
    res.json({ headers: req.headers, hostname: req.hostname, ip: req.ip });
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

  // ── Agencies ──────────────────────────────────────────────────────────────

  app.get("/api/agencies", requireAuth, async (req: Request, res: Response) => {
    const all = await storage.getAgencies();
    return res.json(all);
  });

  app.get("/api/agencies/:id", requireAuth, async (req: Request, res: Response) => {
    const agency = await storage.getAgency(req.params.id as string);
    if (!agency) return res.status(404).json({ message: "Agency not found" });
    return res.json(agency);
  });

  app.post("/api/agencies", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const { name, contactName, email, phone, monthlyFee, startDate, status } = req.body;
    if (!name) return res.status(400).json({ message: "name is required" });
    const agency = await storage.createAgency({ name, contactName, email, phone, monthlyFee, startDate, status: status ?? "active" });
    return res.status(201).json(agency);
  });

  app.put("/api/agencies/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const { name, contactName, email, phone, monthlyFee, startDate, status } = req.body;
    const agency = await storage.updateAgency(req.params.id as string, { name, contactName, email, phone, monthlyFee, startDate, status });
    if (!agency) return res.status(404).json({ message: "Agency not found" });
    return res.json(agency);
  });

  app.delete("/api/agencies/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    await storage.deleteAgency(req.params.id as string);
    return res.json({ message: "Agency deleted" });
  });

  app.get("/api/agencies/:id/accounts", requireAuth, async (req: Request, res: Response) => {
    const accts = await storage.getAgencyAccounts(req.params.id as string);
    return res.json(accts);
  });

  app.get("/api/accounts/:accountId/client-summary", requireAuth, async (req: Request, res: Response) => {
    const accountId = req.params.accountId as string;
    const account = await storage.getAccount(accountId);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const accountWebsites = await storage.getWebsites(accountId);
    const website = accountWebsites[0] ?? null;

    let pageCounts = { total: 0, tier1: 0, tier2: 0, tier3: 0 };
    let bankHealth = { totalServices: 0, safeToScale: 0, needsWork: 0, avgCompleteness: 0 };
    let hubStats = { total: 0, published: 0, drafts: 0 };
    let lastJob: any = null;

    if (website) {
      const { pool } = await import("./db");
      const tiersResult = await pool.query(
        `SELECT tier, COUNT(*)::int as count FROM pages WHERE website_id = $1 AND status = 'published' GROUP BY tier`,
        [website.id]
      );
      pageCounts.total = tiersResult.rows.reduce((s: number, r: any) => s + r.count, 0);
      for (const row of tiersResult.rows) {
        if (row.tier === 1) pageCounts.tier1 = row.count;
        else if (row.tier === 2) pageCounts.tier2 = row.count;
        else if (row.tier === 3) pageCounts.tier3 = row.count;
      }

      const banks = await storage.getBankCompleteness(website.id);
      bankHealth.totalServices = banks.length;
      bankHealth.safeToScale = banks.filter((b: any) => (b.completenessScore ?? 0) >= 70).length;
      bankHealth.needsWork = banks.filter((b: any) => (b.completenessScore ?? 0) < 70).length;
      bankHealth.avgCompleteness = banks.length > 0
        ? Math.round(banks.reduce((s: number, b: any) => s + (b.completenessScore ?? 0), 0) / banks.length)
        : 0;

      const hubs = await storage.getHubPages(website.id);
      hubStats.total = hubs.length;
      hubStats.published = hubs.filter((h: any) => h.status === "published").length;
      hubStats.drafts = hubs.filter((h: any) => h.status !== "published").length;

      const jobs = await storage.getGenerationJobs(website.id);
      lastJob = jobs[0] ?? null;
    }

    return res.json({ account, website, pages: pageCounts, bankHealth, hubPages: hubStats, lastJob });
  });

  app.get("/api/agencies/:id/overview", requireAuth, async (req: Request, res: Response) => {
    const agencyId = req.params.id as string;
    const agencyAccounts = await storage.getAgencyAccounts(agencyId);
    const accountIds = agencyAccounts.map((a: any) => a.id);
    if (accountIds.length === 0) {
      return res.json({ totalClients: 0, totalPages: 0, tier1Pages: 0, banksNeedingWork: 0, activeJobs: 0, clientStatuses: {}, websites: [] });
    }
    const { pool } = await import("./db");
    const pagesRes = await pool.query(
      `SELECT COALESCE(COUNT(*) FILTER (WHERE p.status = 'published'), 0)::int AS total,
              COALESCE(COUNT(*) FILTER (WHERE p.status = 'published' AND p.tier = 1), 0)::int AS tier1
       FROM pages p JOIN websites w ON p.website_id = w.id WHERE w.account_id = ANY($1)`,
      [accountIds]
    );
    const banksRes = await pool.query(
      `SELECT COALESCE(COUNT(*), 0)::int AS count FROM variation_bank_completeness vbc
       JOIN websites w ON vbc.website_id = w.id WHERE w.account_id = ANY($1) AND COALESCE(vbc.completeness_score, 0) < 70`,
      [accountIds]
    );
    const activeJobsRes = await pool.query(
      `SELECT COALESCE(COUNT(*), 0)::int AS count FROM generation_jobs gj
       JOIN websites w ON gj.website_id = w.id WHERE w.account_id = ANY($1) AND gj.status = 'running'`,
      [accountIds]
    );
    const perClientRes = await pool.query(
      `SELECT w.account_id, w.id AS website_id, w.domain,
              COALESCE(SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END), 0)::int AS total_pages,
              COALESCE(SUM(CASE WHEN p.status = 'published' AND p.tier = 1 THEN 1 ELSE 0 END), 0)::int AS tier1_pages,
              (SELECT COALESCE(COUNT(*),0)::int FROM variation_bank_completeness vbc2
               WHERE vbc2.website_id = w.id AND COALESCE(vbc2.completeness_score,0) < 70) AS banks_needing_work,
              (SELECT MAX(gj.created_at) FROM generation_jobs gj WHERE gj.website_id = w.id) AS last_job_date
       FROM websites w LEFT JOIN pages p ON p.website_id = w.id
       WHERE w.account_id = ANY($1) GROUP BY w.id, w.account_id, w.domain`,
      [accountIds]
    );
    const now = Date.now();
    const clientStatuses: Record<string, string> = {};
    const websites: Array<{ accountId: string; id: string; domain: string }> = [];
    for (const row of perClientRes.rows) {
      websites.push({ accountId: row.account_id, id: row.website_id, domain: row.domain });
      const totalPages = row.total_pages ?? 0;
      const tier1 = row.tier1_pages ?? 0;
      const banksNeedingWork = row.banks_needing_work ?? 0;
      const lastJob = row.last_job_date ? new Date(row.last_job_date).getTime() : null;
      const daysSinceJob = lastJob ? (now - lastJob) / 86400000 : Infinity;
      if (totalPages === 0 || daysSinceJob > 60) {
        clientStatuses[row.account_id] = "stalled";
      } else if (banksNeedingWork > 0 || tier1 === 0) {
        clientStatuses[row.account_id] = "needs_attention";
      } else {
        clientStatuses[row.account_id] = "healthy";
      }
    }
    return res.json({
      totalClients: agencyAccounts.length,
      totalPages: pagesRes.rows[0]?.total ?? 0,
      tier1Pages: pagesRes.rows[0]?.tier1 ?? 0,
      banksNeedingWork: banksRes.rows[0]?.count ?? 0,
      activeJobs: activeJobsRes.rows[0]?.count ?? 0,
      clientStatuses,
      websites,
    });
  });

  app.get("/api/agencies/:id/jobs", requireAuth, async (req: Request, res: Response) => {
    const agencyId = req.params.id as string;
    const agencyAccounts = await storage.getAgencyAccounts(agencyId);
    const accountIds = agencyAccounts.map((a: any) => a.id);
    if (accountIds.length === 0) return res.json([]);
    const { pool } = await import("./db");
    const result = await pool.query(
      `SELECT gj.id, gj.status, gj.pages_generated, gj.created_at, gj.completed_at, gj.type,
              a.name AS client_name, w.domain
       FROM generation_jobs gj
       JOIN websites w ON gj.website_id = w.id
       JOIN accounts a ON w.account_id = a.id
       WHERE w.account_id = ANY($1)
       ORDER BY gj.created_at DESC LIMIT 200`,
      [accountIds]
    );
    return res.json(result.rows);
  });

  app.get("/api/agencies/:id/usage", requireAuth, async (req: Request, res: Response) => {
    const agencyId = req.params.id as string;
    const dateRange = (req.query.dateRange as string) || "this_month";

    let sinceClause = "";
    if (dateRange === "this_month") {
      sinceClause = `AND ul.created_at >= date_trunc('month', now())`;
    } else if (dateRange === "last_month") {
      sinceClause = `AND ul.created_at >= date_trunc('month', now() - interval '1 month')
                     AND ul.created_at < date_trunc('month', now())`;
    } else if (dateRange === "last_90_days") {
      sinceClause = `AND ul.created_at >= now() - interval '90 days'`;
    }
    // "all_time" → no filter

    const agencyAccounts = await storage.getAgencyAccounts(agencyId);
    const accountIds = agencyAccounts.map((a: any) => a.id);
    if (accountIds.length === 0) return res.json({ rows: [], totals: { apiCalls: 0, totalTokens: 0, estimatedCostCents: 0 } });

    const { pool } = await import("./db");
    const result = await pool.query(
      `SELECT a.id AS account_id, a.name AS client_name,
              COUNT(ul.id)::int AS api_calls,
              COALESCE(SUM(ul.total_tokens), 0)::bigint AS total_tokens,
              COALESCE(SUM(ul.estimated_cost_cents), 0)::bigint AS estimated_cost_cents
       FROM accounts a
       LEFT JOIN api_usage_log ul ON ul.account_id = a.id ${sinceClause}
       WHERE a.id = ANY($1)
       GROUP BY a.id, a.name
       ORDER BY estimated_cost_cents DESC`,
      [accountIds]
    );

    const rows = result.rows.map((r: any) => ({
      accountId: r.account_id,
      clientName: r.client_name,
      apiCalls: Number(r.api_calls),
      totalTokens: Number(r.total_tokens),
      estimatedCostCents: Number(r.estimated_cost_cents),
    }));

    const totals = rows.reduce(
      (acc: any, r: any) => ({
        apiCalls: acc.apiCalls + r.apiCalls,
        totalTokens: acc.totalTokens + r.totalTokens,
        estimatedCostCents: acc.estimatedCostCents + r.estimatedCostCents,
      }),
      { apiCalls: 0, totalTokens: 0, estimatedCostCents: 0 }
    );

    return res.json({ rows, totals });
  });

  app.get("/api/agencies/:id/export-report", requireAuth, async (req: Request, res: Response) => {
    const agencyId = req.params.id as string;
    const agencyAccounts = await storage.getAgencyAccounts(agencyId);
    const accountIds = agencyAccounts.map((a: any) => a.id);
    if (accountIds.length === 0) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="agency-report.csv"`);
      return res.send("Client Name,Domain,Total Pages,Tier 1,Tier 2,Tier 3,Avg Quality Score,Banks Complete,Banks Needs Work,Last Job Date\n");
    }
    const { pool } = await import("./db");
    const result = await pool.query(
      `SELECT a.name AS client_name, w.domain,
              COALESCE(SUM(CASE WHEN p.status='published' THEN 1 ELSE 0 END), 0)::int AS total_pages,
              COALESCE(SUM(CASE WHEN p.status='published' AND p.tier=1 THEN 1 ELSE 0 END), 0)::int AS tier1,
              COALESCE(SUM(CASE WHEN p.status='published' AND p.tier=2 THEN 1 ELSE 0 END), 0)::int AS tier2,
              COALESCE(SUM(CASE WHEN p.status='published' AND p.tier=3 THEN 1 ELSE 0 END), 0)::int AS tier3,
              ROUND(AVG(p.quality_score) FILTER (WHERE p.quality_score IS NOT NULL))::int AS avg_score,
              (SELECT COALESCE(COUNT(*),0)::int FROM variation_bank_completeness vbc WHERE vbc.website_id = w.id AND COALESCE(vbc.completeness_score,0) >= 70) AS banks_complete,
              (SELECT COALESCE(COUNT(*),0)::int FROM variation_bank_completeness vbc WHERE vbc.website_id = w.id AND COALESCE(vbc.completeness_score,0) < 70) AS banks_needing_work,
              (SELECT MAX(gj.created_at) FROM generation_jobs gj WHERE gj.website_id = w.id) AS last_job_date
       FROM accounts a
       JOIN websites w ON w.account_id = a.id
       LEFT JOIN pages p ON p.website_id = w.id
       WHERE a.id = ANY($1)
       GROUP BY a.name, w.domain, w.id
       ORDER BY a.name`,
      [accountIds]
    );
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = "Client Name,Domain,Total Pages,Tier 1,Tier 2,Tier 3,Avg Quality Score,Banks Complete,Banks Needs Work,Last Job Date";
    const rows = result.rows.map((r: any) =>
      [esc(r.client_name), esc(r.domain), r.total_pages, r.tier1, r.tier2, r.tier3,
       r.avg_score ?? "", r.banks_complete, r.banks_needing_work,
       r.last_job_date ? new Date(r.last_job_date).toISOString().split("T")[0] : ""].join(",")
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="agency-report.csv"`);
    return res.send([header, ...rows].join("\n"));
  });

  // ── Agency Onboarding Wizard ───────────────────────────────────────────────

  app.post("/api/agencies/:agencyId/wizard/suggest-services", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ message: "ANTHROPIC_API_KEY not configured" });
    const { businessName, industry } = req.body;
    if (!businessName || !industry) return res.status(400).json({ message: "businessName and industry are required" });
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const prompt = `You are an expert local SEO strategist. Generate exactly 15 distinct services for a ${industry} business named "${businessName}".

Think about what customers search for when they need ${industry} services. Include a mix of core services, specialty services, and emergency/seasonal services. Return ONLY a JSON array of exactly 15 objects with no markdown, no code fences:
[{"name":"Service Name","slug":"service-slug","description":"1-2 sentence customer-facing description.","keywords":["kw1","kw2","kw3","kw4"]}]`;
      const message = await ai.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3500,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = message.content[0].type === "text" ? message.content[0].text : "";
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return res.status(500).json({ message: "Claude did not return valid JSON" });
      return res.json(JSON.parse(match[0]));
    } catch (err: any) {
      return res.status(500).json({ message: err.message || "Service suggestion failed" });
    }
  });

  app.post("/api/agencies/:agencyId/wizard/launch", requireAuth, async (req: Request, res: Response) => {
    const agencyId = req.params.agencyId as string;
    const {
      businessName, domain, industry, primaryCity, primaryState,
      brandColor, tagline,
      selectedServices = [],
      selectedStates = [],
      cityTiers = [1, 2],
      retryFromStep = 1,
      previousData = {},
    } = req.body;

    if (!businessName || !domain) return res.status(400).json({ message: "businessName and domain are required" });

    const STATE_MAP: Record<string, string> = {
      AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
      CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
      HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
      KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
      MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
      MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
      NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
      OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
      SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
      VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
    };

    const STANDARD_SECTIONS = [
      { id: "intro", type: "intro", enabled: true },
      { id: "how_it_works", type: "how_it_works", enabled: true },
      { id: "benefits", type: "benefits", enabled: true },
      { id: "faq", type: "faq", enabled: true },
      { id: "cta", type: "cta", enabled: true },
    ];

    const steps: any[] = [];
    let accountId: string | undefined = previousData.accountId;
    let websiteId: string | undefined = previousData.websiteId;
    let brandProfileId: string | undefined = previousData.brandProfileId;

    // Step 1: Create account
    if (retryFromStep <= 1) {
      try {
        const base = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const account = await storage.createAccount({
          name: businessName,
          slug: `${base}-${Date.now().toString(36)}`,
          agencyId,
          plan: "starter",
          status: "active",
        });
        accountId = account.id;
        steps.push({ step: 1, name: "Create account", success: true, data: { accountId } });
      } catch (err: any) {
        steps.push({ step: 1, name: "Create account", success: false, error: err.message });
        return res.json({ success: false, failedStep: 1, steps, accountId, websiteId, brandProfileId });
      }
    } else {
      steps.push({ step: 1, name: "Create account", success: true, skipped: true, data: { accountId } });
    }

    // Step 2: Create website
    if (retryFromStep <= 2) {
      try {
        const website = await storage.createWebsite({
          accountId: accountId!,
          name: businessName,
          domain,
          primaryIndustry: industry,
          status: "paused",
          settings: { cityTiers, primaryCity, primaryState },
        });
        websiteId = website.id;
        steps.push({ step: 2, name: "Create website", success: true, data: { websiteId } });
      } catch (err: any) {
        steps.push({ step: 2, name: "Create website", success: false, error: err.message });
        return res.json({ success: false, failedStep: 2, steps, accountId, websiteId, brandProfileId });
      }
    } else {
      steps.push({ step: 2, name: "Create website", success: true, skipped: true, data: { websiteId } });
    }

    // Step 3: Create brand profile and link to website
    if (retryFromStep <= 3) {
      try {
        const bp = await storage.createBrandProfile({
          accountId: accountId!,
          name: businessName,
          primaryColor: brandColor || "#2563eb",
          tagline: tagline || "",
          description: `${businessName} — professional ${industry} services.`,
        });
        brandProfileId = bp.id;
        await storage.updateWebsite(websiteId!, { brandProfileId });
        steps.push({ step: 3, name: "Write brand profile", success: true, data: { brandProfileId } });
      } catch (err: any) {
        steps.push({ step: 3, name: "Write brand profile", success: false, error: err.message });
        return res.json({ success: false, failedStep: 3, steps, accountId, websiteId, brandProfileId });
      }
    } else {
      steps.push({ step: 3, name: "Write brand profile", success: true, skipped: true, data: { brandProfileId } });
    }

    // Step 4: Insert services
    if (retryFromStep <= 4) {
      try {
        for (const svc of selectedServices) {
          await storage.createService({
            accountId: accountId!,
            name: svc.name,
            slug: svc.slug || svc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            description: svc.description || "",
            keywords: svc.keywords || [],
          });
        }
        steps.push({ step: 4, name: "Add services", success: true, data: { count: selectedServices.length } });
      } catch (err: any) {
        steps.push({ step: 4, name: "Add services", success: false, error: err.message });
        return res.json({ success: false, failedStep: 4, steps, accountId, websiteId, brandProfileId });
      }
    } else {
      steps.push({ step: 4, name: "Add services", success: true, skipped: true });
    }

    // Step 5: Insert state-level locations
    if (retryFromStep <= 5) {
      try {
        if (selectedStates.length > 0) {
          const stateItems = selectedStates.map((code: string) => {
            const name = STATE_MAP[code] || code;
            return {
              type: "state" as const,
              name,
              slug: name.toLowerCase().replace(/\s+/g, "-"),
              stateCode: code,
              stateName: name,
            };
          });
          await storage.bulkCreateLocations(accountId!, stateItems);
        }
        steps.push({ step: 5, name: "Set up locations", success: true, data: { states: selectedStates.length } });
      } catch (err: any) {
        steps.push({ step: 5, name: "Set up locations", success: false, error: err.message });
        return res.json({ success: false, failedStep: 5, steps, accountId, websiteId, brandProfileId });
      }
    } else {
      steps.push({ step: 5, name: "Set up locations", success: true, skipped: true });
    }

    // Step 6: Insert blueprints
    if (retryFromStep <= 6) {
      try {
        const blueprintDefs = [
          {
            name: "Service City Pages",
            pageType: "service_city" as const,
            titleTemplate: "{{service}} in {{city}}, {{state}} | {{brandName}}",
            metaDescTemplate: "Looking for {{service}} in {{city}}, {{state}}? {{brandName}} delivers expert results. Call today.",
            h1Template: "{{service}} in {{city}}, {{state}}",
            slugTemplate: "{{service-slug}}/{{city-slug}}-{{state-slug}}",
          },
          {
            name: "State Hub Pages",
            pageType: "state_hub" as const,
            titleTemplate: "{{service}} in {{state}} | {{brandName}}",
            metaDescTemplate: "Expert {{service}} services across {{state}}. {{brandName}} serves communities statewide.",
            h1Template: "{{service}} Services in {{state}}",
            slugTemplate: "{{service-slug}}/{{state-slug}}",
          },
          {
            name: "Problem Intent Pages",
            pageType: "problem_intent" as const,
            titleTemplate: "Best {{service}} Near Me in {{city}} | {{brandName}}",
            metaDescTemplate: "Need {{service}} near you in {{city}}, {{state}}? {{brandName}} is ready to help.",
            h1Template: "Find {{service}} Near Me in {{city}}, {{state}}",
            slugTemplate: "{{service-slug}}/near-me/{{city-slug}}",
          },
        ];
        for (const def of blueprintDefs) {
          await storage.createBlueprint({
            ...def,
            accountId: accountId!,
            websiteId: websiteId!,
            sections: STANDARD_SECTIONS,
          });
        }
        steps.push({ step: 6, name: "Build blueprints", success: true, data: { count: blueprintDefs.length } });
      } catch (err: any) {
        steps.push({ step: 6, name: "Build blueprints", success: false, error: err.message });
        return res.json({ success: false, failedStep: 6, steps, accountId, websiteId, brandProfileId });
      }
    } else {
      steps.push({ step: 6, name: "Build blueprints", success: true, skipped: true });
    }

    // Step 7: Trigger variation bank writing
    if (retryFromStep <= 7) {
      try {
        const allServices = await storage.getServices(accountId!);
        if (allServices.length > 0) {
          const brand = brandProfileId ? await storage.getBrandProfile(brandProfileId) : undefined;
          const ctx = {
            brandName: brand?.name,
            brandDescription: brand?.description ?? undefined,
            voiceAndTone: brand?.voiceAndTone ?? undefined,
            industryName: industry,
            industryDescription: undefined as string | undefined,
          };
          const { startBankWriteJob } = await import("./services/bank-write-background");
          await startBankWriteJob(
            websiteId!,
            accountId!,
            allServices.map((s: any) => ({ id: s.id, name: s.name })),
            ctx,
          );
        }
        steps.push({ step: 7, name: "Trigger variation banks", success: true });
      } catch (err: any) {
        steps.push({ step: 7, name: "Trigger variation banks", success: false, error: err.message });
        return res.json({ success: false, failedStep: 7, steps, accountId, websiteId, brandProfileId });
      }
    } else {
      steps.push({ step: 7, name: "Trigger variation banks", success: true, skipped: true });
    }

    return res.json({ success: true, steps, accountId, websiteId, brandProfileId });
  });

  // ── Clone Client ───────────────────────────────────────────────────────────

  app.get("/api/accounts/:accountId/clone-summary", requireAuth, async (req: Request, res: Response) => {
    const sourceAccountId = req.params.accountId as string;
    const { pool } = await import("./db");

    const [srcServices, srcClusters, srcBlueprints] = await Promise.all([
      storage.getServices(sourceAccountId),
      storage.getQueryClusters(sourceAccountId),
      storage.getBlueprints(sourceAccountId),
    ]);

    const wsRes = await pool.query(
      "SELECT id FROM websites WHERE account_id = $1 ORDER BY created_at LIMIT 1",
      [sourceAccountId]
    );
    const srcWebsiteId = wsRes.rows[0]?.id as string | undefined;
    const bankServices = srcWebsiteId
      ? await storage.getVariationBankServices(srcWebsiteId)
      : [];

    return res.json({
      services: srcServices.length,
      queryClusters: srcClusters.length,
      blueprints: srcBlueprints.length,
      variationBankServices: bankServices.length,
    });
  });

  app.post("/api/accounts/:accountId/clone", requireAuth, async (req: Request, res: Response) => {
    const sourceAccountId = req.params.accountId as string;
    const {
      agencyId,
      businessName,
      domain,
      cloneServices: doSvc = true,
      cloneQueryClusters: doQc = true,
      cloneBlueprints: doBp = true,
      cloneVariationBanks: doVb = true,
    } = req.body;

    if (!businessName || !domain) {
      return res.status(400).json({ message: "businessName and domain are required" });
    }

    const { pool } = await import("./db");

    // ── Read source data (never modified) ─────────────────────────────────
    const [srcServices, srcClusters, srcBlueprints, srcBrandProfiles] = await Promise.all([
      storage.getServices(sourceAccountId),
      storage.getQueryClusters(sourceAccountId),
      storage.getBlueprints(sourceAccountId),
      storage.getBrandProfiles(sourceAccountId),
    ]);

    const wsRes = await pool.query(
      "SELECT id FROM websites WHERE account_id = $1 ORDER BY created_at LIMIT 1",
      [sourceAccountId]
    );
    const srcWebsiteId = wsRes.rows[0]?.id as string | undefined;

    // ── Step 1: Create account ─────────────────────────────────────────────
    const base = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const newAccount = await storage.createAccount({
      name: businessName,
      slug: `${base}-${Date.now().toString(36)}`,
      agencyId,
      plan: "starter",
      status: "active",
    });

    // ── Step 2: Create website ─────────────────────────────────────────────
    const newWebsite = await storage.createWebsite({
      accountId: newAccount.id,
      name: businessName,
      domain,
      status: "paused",
    });

    // ── Step 3: Brand profile (copy structure, new name) ──────────────────
    const srcBp = srcBrandProfiles[0];
    const newBrandProfile = await storage.createBrandProfile({
      accountId: newAccount.id,
      name: businessName,
      primaryColor: srcBp?.primaryColor ?? "#2563eb",
      tagline: srcBp?.tagline ?? "",
      description: srcBp?.description ?? "",
      voiceAndTone: srcBp?.voiceAndTone ?? "",
      logoUrl: srcBp?.logoUrl ?? undefined,
    });
    await storage.updateWebsite(newWebsite.id, { brandProfileId: newBrandProfile.id });

    // ── Step 4: Services ──────────────────────────────────────────────────
    const serviceIdMap: Record<string, string> = {};
    if (doSvc) {
      for (const svc of srcServices) {
        const { id: _id, createdAt: _ca, accountId: _ai, ...rest } = svc as any;
        const newSvc = await storage.createService({ ...rest, accountId: newAccount.id });
        serviceIdMap[svc.id] = newSvc.id;
      }
    }

    // ── Step 5: Query clusters ────────────────────────────────────────────
    if (doQc) {
      for (const qc of srcClusters) {
        const { id: _id, createdAt: _ca, accountId: _ai, serviceId: _si, ...rest } = qc as any;
        const remappedServiceId = _si ? (serviceIdMap[_si] ?? null) : null;
        await storage.createQueryCluster({
          ...rest,
          accountId: newAccount.id,
          serviceId: remappedServiceId,
        });
      }
    }

    // ── Step 6: Blueprints ────────────────────────────────────────────────
    if (doBp) {
      for (const bp of srcBlueprints) {
        const { id: _id, createdAt: _ca, updatedAt: _ua, accountId: _ai, websiteId: _wi, ...rest } = bp as any;
        await storage.createBlueprint({
          ...rest,
          accountId: newAccount.id,
          websiteId: newWebsite.id,
        });
      }
    }

    // ── Step 7: Variation banks ───────────────────────────────────────────
    if (doVb && srcWebsiteId) {
      const bankRows = await pool.query(
        "SELECT service, section_name, variations FROM content_variation_banks WHERE website_id = $1",
        [srcWebsiteId]
      );
      for (const row of bankRows.rows) {
        await storage.createVariationBank({
          accountId: newAccount.id,
          websiteId: newWebsite.id,
          service: row.service,
          sectionName: row.section_name,
          variations: row.variations,
        });
      }
    }

    return res.json({ success: true, accountId: newAccount.id, websiteId: newWebsite.id });
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

  app.put("/api/accounts/:id", requireAuth, async (req: Request, res: Response) => {
    const current = await storage.getAccount(req.params.id as string);
    if (!current) return res.status(404).json({ message: "Account not found" });
    const { name, slug, plan, status, settings, agencyId } = req.body;
    const mergedSettings = { ...(current.settings as Record<string, any> ?? {}), ...(settings ?? {}) };
    const payload: Record<string, any> = { settings: mergedSettings };
    if (name !== undefined) payload.name = name;
    if (slug !== undefined) payload.slug = slug;
    if (plan !== undefined) payload.plan = plan;
    if (status !== undefined) payload.status = status;
    if (agencyId !== undefined) payload.agencyId = agencyId === "" ? null : agencyId;
    const updated = await storage.updateAccount(req.params.id as string, payload as any);
    return res.json(updated);
  });

  app.delete("/api/accounts/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    await storage.deleteAccount((req.params.id as string));
    return res.json({ message: "Account deleted" });
  });

  app.patch("/api/accounts/:accountId/client-status", requireAuth, async (req: Request, res: Response) => {
    const accountId = req.params.accountId as string;
    const { clientStatus } = req.body;
    if (!["active", "paused", "archived"].includes(clientStatus)) {
      return res.status(400).json({ message: "clientStatus must be active, paused, or archived" });
    }
    const account = await storage.getAccount(accountId);
    if (!account) return res.status(404).json({ message: "Account not found" });

    const { pool } = await import("./db");

    if (clientStatus === "archived") {
      await pool.query(
        `UPDATE pages SET noindex = true WHERE website_id IN (SELECT id FROM websites WHERE account_id = $1)`,
        [accountId]
      );
    } else if (account.clientStatus === "archived" && clientStatus === "active") {
      await pool.query(
        `UPDATE pages SET noindex = false WHERE website_id IN (SELECT id FROM websites WHERE account_id = $1)`,
        [accountId]
      );
    }

    await pool.query(`UPDATE accounts SET client_status = $1, updated_at = now() WHERE id = $2`, [clientStatus, accountId]);
    const updated = await storage.getAccount(accountId);
    return res.json(updated);
  });

  // PATCH /api/accounts/:accountId/spend — update monthly SEO investment for ROI calculations
  app.patch("/api/accounts/:accountId/spend", requireAuth, async (req: Request, res: Response) => {
    const accountId = req.params.accountId as string;
    const { monthlySpend } = req.body;
    const spend = parseFloat(monthlySpend);
    if (isNaN(spend) || spend < 0) {
      return res.status(400).json({ error: "monthlySpend must be a non-negative number" });
    }
    const { pool } = await import("./db");
    await pool.query(
      `UPDATE accounts SET monthly_seo_spend = $1, updated_at = now() WHERE id = $2`,
      [spend, accountId],
    );
    return res.json({ success: true, monthlySpend: spend });
  });

  // ── Client Report (public, token-based) ────────────────────────────────────

  app.get("/api/report/:token", async (req: Request, res: Response) => {
    const token = req.params.token as string;
    if (!token || token.length < 16) return res.status(400).json({ error: "Invalid token" });

    const { pool } = await import("./db");

    const acctRes = await pool.query(
      `SELECT id, name FROM accounts WHERE report_token = $1 LIMIT 1`,
      [token]
    );
    if (acctRes.rows.length === 0) return res.status(404).json({ error: "Report not found" });
    const { id: accountId, name: businessName } = acctRes.rows[0];

    const wsRes = await pool.query(
      `SELECT id, domain FROM websites WHERE account_id = $1 ORDER BY created_at LIMIT 1`,
      [accountId]
    );
    const website = wsRes.rows[0] ?? null;
    const websiteId = website?.id as string | undefined;
    const domain = website?.domain ?? "";

    let totalPages = 0, tier1Pages = 0, tier2Pages = 0;
    let servicesCovered = 0;
    let bankTotal = 0, bankFullyWritten = 0;
    const topPages: Array<{ title: string; url: string; qualityScore: number | null; tier: number }> = [];
    let sitemapExists = false;
    let sitemapLastGenerated: string | null = null;

    if (websiteId) {
      const tierRes = await pool.query(
        `SELECT tier, COUNT(*)::int AS cnt FROM pages WHERE website_id = $1 AND status = 'published' GROUP BY tier`,
        [websiteId]
      );
      for (const row of tierRes.rows) {
        totalPages += row.cnt;
        if (row.tier === 1) tier1Pages = row.cnt;
        else if (row.tier === 2) tier2Pages = row.cnt;
      }

      const svcRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM services WHERE account_id = $1`,
        [accountId]
      );
      servicesCovered = svcRes.rows[0]?.cnt ?? 0;

      const bankRes = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(CASE WHEN COALESCE(completeness_score, 0) >= 70 THEN 1 ELSE 0 END), 0)::int AS fully_written
         FROM variation_bank_completeness WHERE website_id = $1`,
        [websiteId]
      );
      bankTotal = bankRes.rows[0]?.total ?? 0;
      bankFullyWritten = bankRes.rows[0]?.fully_written ?? 0;

      const pagesRes = await pool.query(
        `SELECT title, slug, quality_score, tier FROM pages
         WHERE website_id = $1 AND status = 'published' AND quality_score IS NOT NULL
         ORDER BY quality_score DESC LIMIT 10`,
        [websiteId]
      );
      for (const row of pagesRes.rows) {
        topPages.push({
          title: row.title,
          url: `https://${domain}/${row.slug}`,
          qualityScore: row.quality_score,
          tier: row.tier ?? 2,
        });
      }

      const smRes = await pool.query(
        `SELECT MAX(last_generated) AS last_generated, COUNT(*)::int AS cnt FROM sitemaps WHERE website_id = $1`,
        [websiteId]
      );
      sitemapExists = (smRes.rows[0]?.cnt ?? 0) > 0;
      sitemapLastGenerated = smRes.rows[0]?.last_generated ?? null;
    }

    // ── Leads & conversions for current month ─────────────────────────────────
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

    let callsThisMonth = 0;
    let formsThisMonth = 0;
    let bookedJobsCount = 0;
    let totalJobValue = 0;
    const recentFormLeads: Array<{ name: string; submittedAt: string; sourcePageTitle: string | null }> = [];
    const recentBookedJobs: Array<{ jobValue: number; jobStatus: string; bookedAt: string }> = [];

    if (websiteId) {
      const callsRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM tracked_calls
         WHERE website_id = $1 AND call_timestamp >= $2 AND call_timestamp < $3`,
        [websiteId, monthStart, monthEnd],
      );
      callsThisMonth = callsRes.rows[0]?.cnt ?? 0;

      const formsRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt, json_agg(json_build_object(
           'name', submitter_name, 'submittedAt', form_timestamp, 'sourcePageTitle', source_page_title
         ) ORDER BY form_timestamp DESC) AS rows
         FROM tracked_leads
         WHERE website_id = $1 AND form_timestamp >= $2 AND form_timestamp < $3`,
        [websiteId, monthStart, monthEnd],
      );
      formsThisMonth = formsRes.rows[0]?.cnt ?? 0;
      for (const r of (formsRes.rows[0]?.rows ?? []).slice(0, 5)) {
        recentFormLeads.push({
          name: r.name ?? "Unknown",
          submittedAt: r.submittedAt,
          sourcePageTitle: r.sourcePageTitle ?? null,
        });
      }

      const jobsRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt,
                COALESCE(SUM(job_value), 0)::float AS total_value,
                json_agg(json_build_object(
                  'jobValue', job_value, 'jobStatus', status, 'bookedAt', booked_date
                ) ORDER BY booked_date DESC) AS rows
         FROM booked_jobs
         WHERE website_id = $1 AND booked_date >= $2 AND booked_date < $3`,
        [websiteId, monthStart, monthEnd],
      );
      bookedJobsCount = jobsRes.rows[0]?.cnt ?? 0;
      totalJobValue   = jobsRes.rows[0]?.total_value ?? 0;
      for (const r of (jobsRes.rows[0]?.rows ?? []).slice(0, 5)) {
        recentBookedJobs.push({
          jobValue: r.jobValue ?? 0,
          jobStatus: r.jobStatus ?? "completed",
          bookedAt: r.bookedAt,
        });
      }
    }

    const reportMonth = `${now.toLocaleString("en-US", { month: "long" })} ${now.getFullYear()}`;

    // Estimate organic reach from page tiers (conservative model)
    const tier3Pages = totalPages - tier1Pages - tier2Pages;
    const estImpressions = tier1Pages * 200 + tier2Pages * 30 + tier3Pages * 8;
    const estClicks     = Math.round(tier1Pages * 7 + tier2Pages * 0.4 + tier3Pages * 0.04);

    return res.json({
      businessName,
      domain,
      generatedAt: new Date().toISOString(),
      stats: { totalPages, tier1Pages, tier2Pages, servicesCovered, estImpressions, estClicks },
      bankHealth: { totalServices: bankTotal, fullyWritten: bankFullyWritten, needsAttention: bankTotal - bankFullyWritten },
      topPages,
      sitemapStatus: { exists: sitemapExists, lastGenerated: sitemapLastGenerated },
      leads: {
        month: reportMonth,
        callsThisMonth,
        formsThisMonth,
        bookedJobsCount,
        totalJobValue,
        recentFormLeads,
        recentBookedJobs,
      },
    });
  });

  app.post("/api/accounts/:accountId/report-token/reset", requireAuth, async (req: Request, res: Response) => {
    const accountId = req.params.accountId as string;
    const account = await storage.getAccount(accountId);
    if (!account) return res.status(404).json({ message: "Account not found" });
    const { randomBytes } = await import("crypto");
    const newToken = randomBytes(16).toString("hex");
    await storage.updateAccount(accountId, { reportToken: newToken } as any);
    return res.json({ reportToken: newToken });
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

  app.post("/api/accounts/:accountId/brand-profiles/ai-suggest", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: "ANTHROPIC_API_KEY not configured" });
    const { name, websiteUrl, industryName } = req.body as { name?: string; websiteUrl?: string; industryName?: string };
    if (!name) return res.status(400).json({ error: "name is required" });
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const r = await ai.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: `You are a brand copywriter. Given a business name, generate a brand profile for a local service business SEO site.

Business name: ${name}
${websiteUrl ? `Website: ${websiteUrl}` : ""}
${industryName ? `Industry: ${industryName}` : ""}

Return ONLY valid JSON (no markdown) with these exact keys:
{
  "tagline": "Short punchy tagline under 10 words",
  "description": "2-3 sentence brand description focused on local service excellence",
  "voiceAndTone": "2-3 sentence description of brand voice, writing style, and tone for content writers"
}`,
        }],
      });
      const raw = (r.content[0] as any).text.trim();
      const json = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim());
      return res.json(json);
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "AI error" });
    }
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
    const website = await storage.createWebsite(parsed.data);
    if (website.domain) registerCFCustomHostname(website.domain).catch(() => {});
    return res.status(201).json(website);
  });

  app.patch("/api/websites/:id", requireAuth, async (req: Request, res: Response) => {
    const existing = await storage.getWebsite(req.params.id as string);
    const website = await storage.updateWebsite((req.params.id as string), req.body);
    if (!website) return res.status(404).json({ message: "Not found" });
    if (website.domain && website.domain !== existing?.domain) {
      registerCFCustomHostname(website.domain).catch(() => {});
    }
    return res.json(website);
  });

  // Manual trigger: register a website's domain with Cloudflare for SaaS
  app.post("/api/websites/:id/register-domain", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.getWebsite(req.params.id as string);
    if (!website) return res.status(404).json({ message: "Not found" });
    if (!website.domain) return res.status(400).json({ message: "Website has no domain set" });
    const result = await registerCFCustomHostname(website.domain);
    return res.json(result);
  });

  app.delete("/api/websites/:id", requireAuth, async (req: Request, res: Response) => {
    await storage.deleteWebsite((req.params.id as string));
    return res.json({ message: "Deleted" });
  });

  // Convenience: get all locations for a website's account
  app.get("/api/websites/:id/locations", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.getWebsite(req.params.id as string);
    if (!website) return res.status(404).json({ message: "Not found" });
    return res.json(await storage.getLocations(website.accountId));
  });

  // ── Locations ─────────────────────────────────────────────────────────────

  app.get("/api/accounts/:accountId/locations/count", requireAuth, async (req: Request, res: Response) => {
    const type = req.query.type as string | undefined;
    const search = req.query.search as string | undefined;
    const cityTier = req.query.cityTier ? parseInt(req.query.cityTier as string, 10) : undefined;
    const total = await storage.countLocations(req.params.accountId as string, type, search, cityTier);
    return res.json({ total });
  });

  app.get("/api/accounts/:accountId/locations", requireAuth, async (req: Request, res: Response) => {
    const type = req.query.type as string | undefined;
    const orderBy = req.query.orderBy as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    const search = req.query.search as string | undefined;
    const cityTier = req.query.cityTier ? parseInt(req.query.cityTier as string, 10) : undefined;
    return res.json(await storage.getLocations((req.params.accountId as string), type, orderBy, limit, offset, search, cityTier));
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

  app.post("/api/accounts/:accountId/locations/load-standard", requireAuth, async (req: Request, res: Response) => {
    const accountId = req.params.accountId as string;
    const account = await storage.getAccount(accountId);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const rawCities = [
      { name: "New York City", stateName: "New York", stateAbbreviation: "NY", population: 8260000 },
      { name: "Los Angeles", stateName: "California", stateAbbreviation: "CA", population: 3820000 },
      { name: "Chicago", stateName: "Illinois", stateAbbreviation: "IL", population: 2660000 },
      { name: "Houston", stateName: "Texas", stateAbbreviation: "TX", population: 2380000 },
      { name: "Phoenix", stateName: "Arizona", stateAbbreviation: "AZ", population: 1720000 },
      { name: "Philadelphia", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 1550000 },
      { name: "San Antonio", stateName: "Texas", stateAbbreviation: "TX", population: 1520000 },
      { name: "San Diego", stateName: "California", stateAbbreviation: "CA", population: 1420000 },
      { name: "Dallas", stateName: "Texas", stateAbbreviation: "TX", population: 1330000 },
      { name: "San Jose", stateName: "California", stateAbbreviation: "CA", population: 1040000 },
      { name: "Jacksonville", stateName: "Florida", stateAbbreviation: "FL", population: 1030000 },
      { name: "Austin", stateName: "Texas", stateAbbreviation: "TX", population: 1000000 },
      { name: "Fort Worth", stateName: "Texas", stateAbbreviation: "TX", population: 1000000 },
      { name: "Charlotte", stateName: "North Carolina", stateAbbreviation: "NC", population: 929000 },
      { name: "Columbus", stateName: "Ohio", stateAbbreviation: "OH", population: 924000 },
      { name: "Indianapolis", stateName: "Indiana", stateAbbreviation: "IN", population: 906000 },
      { name: "San Francisco", stateName: "California", stateAbbreviation: "CA", population: 828000 },
      { name: "Seattle", stateName: "Washington", stateAbbreviation: "WA", population: 763000 },
      { name: "Denver", stateName: "Colorado", stateAbbreviation: "CO", population: 748000 },
      { name: "Nashville", stateName: "Tennessee", stateAbbreviation: "TN", population: 730000 },
      { name: "El Paso", stateName: "Texas", stateAbbreviation: "TX", population: 706000 },
      { name: "Oklahoma City", stateName: "Oklahoma", stateAbbreviation: "OK", population: 700000 },
      { name: "Washington", stateName: "District of Columbia", stateAbbreviation: "DC", population: 693000 },
      { name: "Las Vegas", stateName: "Nevada", stateAbbreviation: "NV", population: 676000 },
      { name: "Louisville", stateName: "Kentucky", stateAbbreviation: "KY", population: 641000 },
      { name: "Portland", stateName: "Oregon", stateAbbreviation: "OR", population: 631000 },
      { name: "Memphis", stateName: "Tennessee", stateAbbreviation: "TN", population: 619000 },
      { name: "Atlanta", stateName: "Georgia", stateAbbreviation: "GA", population: 524000 },
      { name: "Raleigh", stateName: "North Carolina", stateAbbreviation: "NC", population: 467000 },
      { name: "Miami", stateName: "Florida", stateAbbreviation: "FL", population: 456000 },
      { name: "Minneapolis", stateName: "Minnesota", stateAbbreviation: "MN", population: 425000 },
      { name: "Tulsa", stateName: "Oklahoma", stateAbbreviation: "OK", population: 413000 },
      { name: "Bakersfield", stateName: "California", stateAbbreviation: "CA", population: 407000 },
      { name: "Tampa", stateName: "Florida", stateAbbreviation: "FL", population: 406000 },
      { name: "Wichita", stateName: "Kansas", stateAbbreviation: "KS", population: 397000 },
      { name: "Arlington", stateName: "Texas", stateAbbreviation: "TX", population: 394000 },
      { name: "Aurora", stateName: "Colorado", stateAbbreviation: "CO", population: 390000 },
      { name: "New Orleans", stateName: "Louisiana", stateAbbreviation: "LA", population: 383000 },
      { name: "Cleveland", stateName: "Ohio", stateAbbreviation: "OH", population: 361000 },
      { name: "Anaheim", stateName: "California", stateAbbreviation: "CA", population: 350000 },
      { name: "Santa Ana", stateName: "California", stateAbbreviation: "CA", population: 332000 },
      { name: "Henderson", stateName: "Nevada", stateAbbreviation: "NV", population: 320000 },
      { name: "Riverside", stateName: "California", stateAbbreviation: "CA", population: 320000 },
      { name: "Orlando", stateName: "Florida", stateAbbreviation: "FL", population: 320000 },
      { name: "Stockton", stateName: "California", stateAbbreviation: "CA", population: 322000 },
      { name: "Lexington", stateName: "Kentucky", stateAbbreviation: "KY", population: 323000 },
      { name: "Corpus Christi", stateName: "Texas", stateAbbreviation: "TX", population: 317000 },
      { name: "St. Paul", stateName: "Minnesota", stateAbbreviation: "MN", population: 311000 },
      { name: "Irvine", stateName: "California", stateAbbreviation: "CA", population: 310000 },
      { name: "Cincinnati", stateName: "Ohio", stateAbbreviation: "OH", population: 309000 },
      { name: "Pittsburgh", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 302000 },
      { name: "Greensboro", stateName: "North Carolina", stateAbbreviation: "NC", population: 301000 },
      { name: "St. Louis", stateName: "Missouri", stateAbbreviation: "MO", population: 301000 },
      { name: "Lincoln", stateName: "Nebraska", stateAbbreviation: "NE", population: 295000 },
      { name: "Plano", stateName: "Texas", stateAbbreviation: "TX", population: 290000 },
      { name: "Durham", stateName: "North Carolina", stateAbbreviation: "NC", population: 290000 },
      { name: "Anchorage", stateName: "Alaska", stateAbbreviation: "AK", population: 291000 },
      { name: "Jersey City", stateName: "New Jersey", stateAbbreviation: "NJ", population: 292000 },
      { name: "Buffalo", stateName: "New York", stateAbbreviation: "NY", population: 276000 },
      { name: "Fort Wayne", stateName: "Indiana", stateAbbreviation: "IN", population: 270000 },
      { name: "Chandler", stateName: "Arizona", stateAbbreviation: "AZ", population: 275000 },
      { name: "Gilbert", stateName: "Arizona", stateAbbreviation: "AZ", population: 267000 },
      { name: "Madison", stateName: "Wisconsin", stateAbbreviation: "WI", population: 269000 },
      { name: "Reno", stateName: "Nevada", stateAbbreviation: "NV", population: 264000 },
      { name: "Lubbock", stateName: "Texas", stateAbbreviation: "TX", population: 264000 },
      { name: "North Las Vegas", stateName: "Nevada", stateAbbreviation: "NV", population: 262000 },
      { name: "Scottsdale", stateName: "Arizona", stateAbbreviation: "AZ", population: 258000 },
      { name: "Chesapeake", stateName: "Virginia", stateAbbreviation: "VA", population: 249000 },
      { name: "Glendale", stateName: "Arizona", stateAbbreviation: "AZ", population: 248000 },
      { name: "Winston-Salem", stateName: "North Carolina", stateAbbreviation: "NC", population: 251000 },
      { name: "Garland", stateName: "Texas", stateAbbreviation: "TX", population: 242000 },
      { name: "Boise", stateName: "Idaho", stateAbbreviation: "ID", population: 235000 },
      { name: "Fremont", stateName: "California", stateAbbreviation: "CA", population: 230000 },
      { name: "Spokane", stateName: "Washington", stateAbbreviation: "WA", population: 228000 },
      { name: "Richmond", stateName: "Virginia", stateAbbreviation: "VA", population: 230000 },
      { name: "Santa Clarita", stateName: "California", stateAbbreviation: "CA", population: 228000 },
      { name: "Baton Rouge", stateName: "Louisiana", stateAbbreviation: "LA", population: 220000 },
      { name: "Tacoma", stateName: "Washington", stateAbbreviation: "WA", population: 219000 },
      { name: "Modesto", stateName: "California", stateAbbreviation: "CA", population: 218000 },
      { name: "Huntsville", stateName: "Alabama", stateAbbreviation: "AL", population: 215000 },
      { name: "Des Moines", stateName: "Iowa", stateAbbreviation: "IA", population: 215000 },
      { name: "Cape Coral", stateName: "Florida", stateAbbreviation: "FL", population: 214000 },
      { name: "Fontana", stateName: "California", stateAbbreviation: "CA", population: 214000 },
      { name: "Moreno Valley", stateName: "California", stateAbbreviation: "CA", population: 213000 },
      { name: "Hialeah", stateName: "Florida", stateAbbreviation: "FL", population: 212000 },
      { name: "Birmingham", stateName: "Alabama", stateAbbreviation: "AL", population: 212000 },
      { name: "Yonkers", stateName: "New York", stateAbbreviation: "NY", population: 211000 },
      { name: "Rochester", stateName: "New York", stateAbbreviation: "NY", population: 211000 },
      { name: "Salt Lake City", stateName: "Utah", stateAbbreviation: "UT", population: 205000 },
      { name: "Oxnard", stateName: "California", stateAbbreviation: "CA", population: 203000 },
      { name: "Augusta", stateName: "Georgia", stateAbbreviation: "GA", population: 202000 },
      { name: "Little Rock", stateName: "Arkansas", stateAbbreviation: "AR", population: 202000 },
      { name: "Amarillo", stateName: "Texas", stateAbbreviation: "TX", population: 200000 },
      { name: "Montgomery", stateName: "Alabama", stateAbbreviation: "AL", population: 200000 },
      { name: "Frisco", stateName: "Texas", stateAbbreviation: "TX", population: 200000 },
      { name: "Tallahassee", stateName: "Florida", stateAbbreviation: "FL", population: 197000 },
      { name: "Overland Park", stateName: "Kansas", stateAbbreviation: "KS", population: 197000 },
      { name: "Grand Rapids", stateName: "Michigan", stateAbbreviation: "MI", population: 198000 },
      { name: "Huntington Beach", stateName: "California", stateAbbreviation: "CA", population: 198000 },
      { name: "Glendale", stateName: "California", stateAbbreviation: "CA", population: 196000 },
      { name: "Columbus", stateName: "Georgia", stateAbbreviation: "GA", population: 195000 },
      { name: "Sioux Falls", stateName: "South Dakota", stateAbbreviation: "SD", population: 196000 },
      { name: "Grand Prairie", stateName: "Texas", stateAbbreviation: "TX", population: 196000 },
      { name: "McKinney", stateName: "Texas", stateAbbreviation: "TX", population: 195000 },
      { name: "Knoxville", stateName: "Tennessee", stateAbbreviation: "TN", population: 192000 },
      { name: "Vancouver", stateName: "Washington", stateAbbreviation: "WA", population: 190000 },
      { name: "Akron", stateName: "Ohio", stateAbbreviation: "OH", population: 190000 },
      { name: "Peoria", stateName: "Arizona", stateAbbreviation: "AZ", population: 190000 },
      { name: "Newark", stateName: "New Jersey", stateAbbreviation: "NJ", population: 282000 },
      { name: "Fayetteville", stateName: "North Carolina", stateAbbreviation: "NC", population: 208000 },
      { name: "Fort Lauderdale", stateName: "Florida", stateAbbreviation: "FL", population: 186000 },
      { name: "Shreveport", stateName: "Louisiana", stateAbbreviation: "LA", population: 187000 },
      { name: "Mobile", stateName: "Alabama", stateAbbreviation: "AL", population: 187000 },
      { name: "Tempe", stateName: "Arizona", stateAbbreviation: "AZ", population: 185000 },
      { name: "Ontario", stateName: "California", stateAbbreviation: "CA", population: 185000 },
      { name: "Worcester", stateName: "Massachusetts", stateAbbreviation: "MA", population: 185000 },
      { name: "Brownsville", stateName: "Texas", stateAbbreviation: "TX", population: 183000 },
      { name: "Aurora", stateName: "Illinois", stateAbbreviation: "IL", population: 180000 },
      { name: "Cary", stateName: "North Carolina", stateAbbreviation: "NC", population: 180000 },
      { name: "Santa Rosa", stateName: "California", stateAbbreviation: "CA", population: 178000 },
      { name: "Providence", stateName: "Rhode Island", stateAbbreviation: "RI", population: 179000 },
      { name: "Elk Grove", stateName: "California", stateAbbreviation: "CA", population: 177000 },
      { name: "Rancho Cucamonga", stateName: "California", stateAbbreviation: "CA", population: 177000 },
      { name: "Eugene", stateName: "Oregon", stateAbbreviation: "OR", population: 176000 },
      { name: "Oceanside", stateName: "California", stateAbbreviation: "CA", population: 175000 },
      { name: "Salem", stateName: "Oregon", stateAbbreviation: "OR", population: 175000 },
      { name: "Newport News", stateName: "Virginia", stateAbbreviation: "VA", population: 186000 },
      { name: "Garden Grove", stateName: "California", stateAbbreviation: "CA", population: 171000 },
      { name: "Clarksville", stateName: "Tennessee", stateAbbreviation: "TN", population: 166000 },
      { name: "Pembroke Pines", stateName: "Florida", stateAbbreviation: "FL", population: 165000 },
      { name: "Hayward", stateName: "California", stateAbbreviation: "CA", population: 162000 },
      { name: "Lancaster", stateName: "California", stateAbbreviation: "CA", population: 161000 },
      { name: "Alexandria", stateName: "Virginia", stateAbbreviation: "VA", population: 160000 },
      { name: "Macon", stateName: "Georgia", stateAbbreviation: "GA", population: 157000 },
      { name: "Salinas", stateName: "California", stateAbbreviation: "CA", population: 157000 },
      { name: "Lakewood", stateName: "Colorado", stateAbbreviation: "CO", population: 157000 },
      { name: "Killeen", stateName: "Texas", stateAbbreviation: "TX", population: 153000 },
      { name: "Jackson", stateName: "Mississippi", stateAbbreviation: "MS", population: 153000 },
      { name: "Hollywood", stateName: "Florida", stateAbbreviation: "FL", population: 153000 },
      { name: "Murfreesboro", stateName: "Tennessee", stateAbbreviation: "TN", population: 152000 },
      { name: "Pomona", stateName: "California", stateAbbreviation: "CA", population: 151000 },
      { name: "Escondido", stateName: "California", stateAbbreviation: "CA", population: 151000 },
      { name: "Pasadena", stateName: "Texas", stateAbbreviation: "TX", population: 151000 },
      { name: "Kansas City", stateName: "Kansas", stateAbbreviation: "KS", population: 153000 },
      { name: "Sunnyvale", stateName: "California", stateAbbreviation: "CA", population: 155000 },
      { name: "Bellevue", stateName: "Washington", stateAbbreviation: "WA", population: 148000 },
      { name: "Surprise", stateName: "Arizona", stateAbbreviation: "AZ", population: 148000 },
      { name: "Denton", stateName: "Texas", stateAbbreviation: "TX", population: 148000 },
      { name: "Syracuse", stateName: "New York", stateAbbreviation: "NY", population: 148000 },
      { name: "Savannah", stateName: "Georgia", stateAbbreviation: "GA", population: 147000 },
      { name: "Torrance", stateName: "California", stateAbbreviation: "CA", population: 147000 },
      { name: "Roseville", stateName: "California", stateAbbreviation: "CA", population: 147000 },
      { name: "Rockford", stateName: "Illinois", stateAbbreviation: "IL", population: 145000 },
      { name: "Paterson", stateName: "New Jersey", stateAbbreviation: "NJ", population: 145000 },
      { name: "Bridgeport", stateName: "Connecticut", stateAbbreviation: "CT", population: 145000 },
      { name: "Gainesville", stateName: "Florida", stateAbbreviation: "FL", population: 143000 },
      { name: "Mesquite", stateName: "Texas", stateAbbreviation: "TX", population: 143000 },
      { name: "McAllen", stateName: "Texas", stateAbbreviation: "TX", population: 143000 },
      { name: "Visalia", stateName: "California", stateAbbreviation: "CA", population: 141000 },
      { name: "Olathe", stateName: "Kansas", stateAbbreviation: "KS", population: 141000 },
      { name: "Thornton", stateName: "Colorado", stateAbbreviation: "CO", population: 140000 },
      { name: "West Valley City", stateName: "Utah", stateAbbreviation: "UT", population: 140000 },
      { name: "Miramar", stateName: "Florida", stateAbbreviation: "FL", population: 140000 },
      { name: "Waco", stateName: "Texas", stateAbbreviation: "TX", population: 139000 },
      { name: "Elizabeth", stateName: "New Jersey", stateAbbreviation: "NJ", population: 137000 },
      { name: "Hampton", stateName: "Virginia", stateAbbreviation: "VA", population: 137000 },
      { name: "Dayton", stateName: "Ohio", stateAbbreviation: "OH", population: 137000 },
      { name: "Columbia", stateName: "South Carolina", stateAbbreviation: "SC", population: 136000 },
      { name: "Warren", stateName: "Michigan", stateAbbreviation: "MI", population: 135000 },
      { name: "Lakewood", stateName: "New Jersey", stateAbbreviation: "NJ", population: 135000 },
      { name: "Cedar Rapids", stateName: "Iowa", stateAbbreviation: "IA", population: 135000 },
      { name: "Stamford", stateName: "Connecticut", stateAbbreviation: "CT", population: 135000 },
      { name: "Midland", stateName: "Texas", stateAbbreviation: "TX", population: 132000 },
      { name: "Sterling Heights", stateName: "Michigan", stateAbbreviation: "MI", population: 132000 },
      { name: "New Haven", stateName: "Connecticut", stateAbbreviation: "CT", population: 130000 },
      { name: "Thousand Oaks", stateName: "California", stateAbbreviation: "CA", population: 128000 },
      { name: "Concord", stateName: "California", stateAbbreviation: "CA", population: 128000 },
      { name: "Santa Clara", stateName: "California", stateAbbreviation: "CA", population: 127000 },
      { name: "Athens", stateName: "Georgia", stateAbbreviation: "GA", population: 127000 },
      { name: "Topeka", stateName: "Kansas", stateAbbreviation: "KS", population: 126000 },
      { name: "Columbia", stateName: "Missouri", stateAbbreviation: "MO", population: 126000 },
      { name: "Simi Valley", stateName: "California", stateAbbreviation: "CA", population: 125000 },
      { name: "Abilene", stateName: "Texas", stateAbbreviation: "TX", population: 122000 },
      { name: "Rochester", stateName: "Minnesota", stateAbbreviation: "MN", population: 121000 },
      { name: "Hartford", stateName: "Connecticut", stateAbbreviation: "CT", population: 121000 },
      { name: "Murrieta", stateName: "California", stateAbbreviation: "CA", population: 119000 },
      { name: "West Palm Beach", stateName: "Florida", stateAbbreviation: "FL", population: 118000 },
      { name: "Evansville", stateName: "Indiana", stateAbbreviation: "IN", population: 118000 },
      { name: "Arvada", stateName: "Colorado", stateAbbreviation: "CO", population: 118000 },
      { name: "Clearwater", stateName: "Florida", stateAbbreviation: "FL", population: 117000 },
      { name: "Beaumont", stateName: "Texas", stateAbbreviation: "TX", population: 116000 },
      { name: "Provo", stateName: "Utah", stateAbbreviation: "UT", population: 115000 },
      { name: "Waterbury", stateName: "Connecticut", stateAbbreviation: "CT", population: 115000 },
      { name: "Springfield", stateName: "Illinois", stateAbbreviation: "IL", population: 114000 },
      { name: "Odessa", stateName: "Texas", stateAbbreviation: "TX", population: 114000 },
      { name: "Peoria", stateName: "Illinois", stateAbbreviation: "IL", population: 113000 },
      { name: "Lansing", stateName: "Michigan", stateAbbreviation: "MI", population: 112000 },
      { name: "Pompano Beach", stateName: "Florida", stateAbbreviation: "FL", population: 112000 },
      { name: "Pueblo", stateName: "Colorado", stateAbbreviation: "CO", population: 111000 },
      { name: "Ventura", stateName: "California", stateAbbreviation: "CA", population: 110000 },
      { name: "Temecula", stateName: "California", stateAbbreviation: "CA", population: 110000 },
      { name: "Norfolk", stateName: "Virginia", stateAbbreviation: "VA", population: 238000 },
      { name: "Toledo", stateName: "Ohio", stateAbbreviation: "OH", population: 270000 },
      { name: "St. Petersburg", stateName: "Florida", stateAbbreviation: "FL", population: 265000 },
      { name: "Laredo", stateName: "Texas", stateAbbreviation: "TX", population: 261000 },
      { name: "Palmdale", stateName: "California", stateAbbreviation: "CA", population: 169000 },
      { name: "Fort Collins", stateName: "Colorado", stateAbbreviation: "CO", population: 169000 },
      { name: "Springfield", stateName: "Missouri", stateAbbreviation: "MO", population: 169000 },
      { name: "Corona", stateName: "California", stateAbbreviation: "CA", population: 168000 },
      { name: "Pasadena", stateName: "California", stateAbbreviation: "CA", population: 138000 },
      { name: "Fayetteville", stateName: "Arkansas", stateAbbreviation: "AR", population: 99000 },
      { name: "Spokane Valley", stateName: "Washington", stateAbbreviation: "WA", population: 100000 },
      { name: "Westminster", stateName: "Colorado", stateAbbreviation: "CO", population: 113000 },
      { name: "South Bend", stateName: "Indiana", stateAbbreviation: "IN", population: 103000 },
      { name: "Erie", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 97000 },
      { name: "Flint", stateName: "Michigan", stateAbbreviation: "MI", population: 96000 },
      // California additions
      { name: "Vallejo", stateName: "California", stateAbbreviation: "CA", population: 121000 },
      { name: "Inglewood", stateName: "California", stateAbbreviation: "CA", population: 109000 },
      { name: "Downey", stateName: "California", stateAbbreviation: "CA", population: 111000 },
      { name: "Costa Mesa", stateName: "California", stateAbbreviation: "CA", population: 111000 },
      { name: "El Monte", stateName: "California", stateAbbreviation: "CA", population: 106000 },
      { name: "West Covina", stateName: "California", stateAbbreviation: "CA", population: 106000 },
      { name: "Norwalk", stateName: "California", stateAbbreviation: "CA", population: 103000 },
      { name: "Burbank", stateName: "California", stateAbbreviation: "CA", population: 104000 },
      { name: "El Cajon", stateName: "California", stateAbbreviation: "CA", population: 102000 },
      { name: "Fairfield", stateName: "California", stateAbbreviation: "CA", population: 119000 },
      { name: "Antioch", stateName: "California", stateAbbreviation: "CA", population: 115000 },
      { name: "Richmond", stateName: "California", stateAbbreviation: "CA", population: 116000 },
      { name: "Chula Vista", stateName: "California", stateAbbreviation: "CA", population: 275000 },
      // Arizona additions
      { name: "Tucson", stateName: "Arizona", stateAbbreviation: "AZ", population: 542000 },
      { name: "Mesa", stateName: "Arizona", stateAbbreviation: "AZ", population: 504000 },
      { name: "Yuma", stateName: "Arizona", stateAbbreviation: "AZ", population: 98000 },
      { name: "Avondale", stateName: "Arizona", stateAbbreviation: "AZ", population: 88000 },
      { name: "Goodyear", stateName: "Arizona", stateAbbreviation: "AZ", population: 87000 },
      { name: "Flagstaff", stateName: "Arizona", stateAbbreviation: "AZ", population: 73000 },
      { name: "Buckeye", stateName: "Arizona", stateAbbreviation: "AZ", population: 91000 },
      { name: "Casa Grande", stateName: "Arizona", stateAbbreviation: "AZ", population: 58000 },
      { name: "Lake Havasu City", stateName: "Arizona", stateAbbreviation: "AZ", population: 53000 },
      { name: "Maricopa", stateName: "Arizona", stateAbbreviation: "AZ", population: 50000 },
      // Nevada additions
      { name: "Sparks", stateName: "Nevada", stateAbbreviation: "NV", population: 104000 },
      { name: "Carson City", stateName: "Nevada", stateAbbreviation: "NV", population: 58000 },
      // Oregon additions
      { name: "Gresham", stateName: "Oregon", stateAbbreviation: "OR", population: 111000 },
      { name: "Hillsboro", stateName: "Oregon", stateAbbreviation: "OR", population: 106000 },
      { name: "Beaverton", stateName: "Oregon", stateAbbreviation: "OR", population: 98000 },
      { name: "Bend", stateName: "Oregon", stateAbbreviation: "OR", population: 102000 },
      { name: "Medford", stateName: "Oregon", stateAbbreviation: "OR", population: 82000 },
      { name: "Springfield", stateName: "Oregon", stateAbbreviation: "OR", population: 61000 },
      { name: "Corvallis", stateName: "Oregon", stateAbbreviation: "OR", population: 59000 },
      { name: "Albany", stateName: "Oregon", stateAbbreviation: "OR", population: 56000 },
      // Washington additions
      { name: "Kent", stateName: "Washington", stateAbbreviation: "WA", population: 132000 },
      { name: "Everett", stateName: "Washington", stateAbbreviation: "WA", population: 116000 },
      { name: "Renton", stateName: "Washington", stateAbbreviation: "WA", population: 106000 },
      { name: "Kirkland", stateName: "Washington", stateAbbreviation: "WA", population: 92000 },
      { name: "Bellingham", stateName: "Washington", stateAbbreviation: "WA", population: 92000 },
      { name: "Kennewick", stateName: "Washington", stateAbbreviation: "WA", population: 82000 },
      { name: "Yakima", stateName: "Washington", stateAbbreviation: "WA", population: 96000 },
      { name: "Redmond", stateName: "Washington", stateAbbreviation: "WA", population: 67000 },
      { name: "Marysville", stateName: "Washington", stateAbbreviation: "WA", population: 67000 },
      { name: "Pasco", stateName: "Washington", stateAbbreviation: "WA", population: 77000 },
      { name: "Federal Way", stateName: "Washington", stateAbbreviation: "WA", population: 96000 },
      { name: "Richland", stateName: "Washington", stateAbbreviation: "WA", population: 60000 },
      { name: "Shoreline", stateName: "Washington", stateAbbreviation: "WA", population: 55000 },
      { name: "Sammamish", stateName: "Washington", stateAbbreviation: "WA", population: 65000 },
      { name: "Burien", stateName: "Washington", stateAbbreviation: "WA", population: 52000 },
      { name: "Lacey", stateName: "Washington", stateAbbreviation: "WA", population: 60000 },
      // Colorado additions
      { name: "Colorado Springs", stateName: "Colorado", stateAbbreviation: "CO", population: 478000 },
      { name: "Centennial", stateName: "Colorado", stateAbbreviation: "CO", population: 108000 },
      { name: "Boulder", stateName: "Colorado", stateAbbreviation: "CO", population: 105000 },
      { name: "Highlands Ranch", stateName: "Colorado", stateAbbreviation: "CO", population: 96000 },
      { name: "Greeley", stateName: "Colorado", stateAbbreviation: "CO", population: 108000 },
      { name: "Longmont", stateName: "Colorado", stateAbbreviation: "CO", population: 97000 },
      { name: "Loveland", stateName: "Colorado", stateAbbreviation: "CO", population: 77000 },
      { name: "Broomfield", stateName: "Colorado", stateAbbreviation: "CO", population: 72000 },
      { name: "Castle Rock", stateName: "Colorado", stateAbbreviation: "CO", population: 72000 },
      { name: "Commerce City", stateName: "Colorado", stateAbbreviation: "CO", population: 57000 },
      { name: "Parker", stateName: "Colorado", stateAbbreviation: "CO", population: 57000 },
      // Utah additions
      { name: "West Jordan", stateName: "Utah", stateAbbreviation: "UT", population: 116000 },
      { name: "Orem", stateName: "Utah", stateAbbreviation: "UT", population: 98000 },
      { name: "Sandy", stateName: "Utah", stateAbbreviation: "UT", population: 96000 },
      { name: "Ogden", stateName: "Utah", stateAbbreviation: "UT", population: 87000 },
      { name: "St. George", stateName: "Utah", stateAbbreviation: "UT", population: 90000 },
      { name: "Layton", stateName: "Utah", stateAbbreviation: "UT", population: 82000 },
      { name: "Taylorsville", stateName: "Utah", stateAbbreviation: "UT", population: 58000 },
      { name: "South Jordan", stateName: "Utah", stateAbbreviation: "UT", population: 72000 },
      { name: "Logan", stateName: "Utah", stateAbbreviation: "UT", population: 51000 },
      { name: "Lehi", stateName: "Utah", stateAbbreviation: "UT", population: 75000 },
      // New Mexico
      { name: "Albuquerque", stateName: "New Mexico", stateAbbreviation: "NM", population: 564000 },
      { name: "Las Cruces", stateName: "New Mexico", stateAbbreviation: "NM", population: 111000 },
      { name: "Rio Rancho", stateName: "New Mexico", stateAbbreviation: "NM", population: 104000 },
      { name: "Santa Fe", stateName: "New Mexico", stateAbbreviation: "NM", population: 84000 },
      // Nebraska additions
      { name: "Omaha", stateName: "Nebraska", stateAbbreviation: "NE", population: 486000 },
      { name: "Bellevue", stateName: "Nebraska", stateAbbreviation: "NE", population: 63000 },
      { name: "Grand Island", stateName: "Nebraska", stateAbbreviation: "NE", population: 51000 },
      // Kansas additions
      { name: "Lawrence", stateName: "Kansas", stateAbbreviation: "KS", population: 98000 },
      { name: "Shawnee", stateName: "Kansas", stateAbbreviation: "KS", population: 68000 },
      { name: "Manhattan", stateName: "Kansas", stateAbbreviation: "KS", population: 54000 },
      { name: "Lenexa", stateName: "Kansas", stateAbbreviation: "KS", population: 57000 },
      // Missouri additions
      { name: "Kansas City", stateName: "Missouri", stateAbbreviation: "MO", population: 495000 },
      { name: "Independence", stateName: "Missouri", stateAbbreviation: "MO", population: 117000 },
      { name: "Lee Summit", stateName: "Missouri", stateAbbreviation: "MO", population: 102000 },
      { name: "O Fallon", stateName: "Missouri", stateAbbreviation: "MO", population: 90000 },
      { name: "St. Joseph", stateName: "Missouri", stateAbbreviation: "MO", population: 74000 },
      { name: "St. Charles", stateName: "Missouri", stateAbbreviation: "MO", population: 69000 },
      { name: "Blue Springs", stateName: "Missouri", stateAbbreviation: "MO", population: 56000 },
      // Oklahoma additions
      { name: "Norman", stateName: "Oklahoma", stateAbbreviation: "OK", population: 128000 },
      { name: "Broken Arrow", stateName: "Oklahoma", stateAbbreviation: "OK", population: 113000 },
      { name: "Lawton", stateName: "Oklahoma", stateAbbreviation: "OK", population: 94000 },
      { name: "Edmond", stateName: "Oklahoma", stateAbbreviation: "OK", population: 93000 },
      { name: "Moore", stateName: "Oklahoma", stateAbbreviation: "OK", population: 62000 },
      { name: "Midwest City", stateName: "Oklahoma", stateAbbreviation: "OK", population: 57000 },
      { name: "Enid", stateName: "Oklahoma", stateAbbreviation: "OK", population: 50000 },
      { name: "Stillwater", stateName: "Oklahoma", stateAbbreviation: "OK", population: 50000 },
      // Arkansas additions
      { name: "Fort Smith", stateName: "Arkansas", stateAbbreviation: "AR", population: 88000 },
      { name: "Springdale", stateName: "Arkansas", stateAbbreviation: "AR", population: 85000 },
      { name: "Jonesboro", stateName: "Arkansas", stateAbbreviation: "AR", population: 78000 },
      { name: "North Little Rock", stateName: "Arkansas", stateAbbreviation: "AR", population: 65000 },
      { name: "Conway", stateName: "Arkansas", stateAbbreviation: "AR", population: 68000 },
      { name: "Rogers", stateName: "Arkansas", stateAbbreviation: "AR", population: 68000 },
      // Louisiana additions
      { name: "Lafayette", stateName: "Louisiana", stateAbbreviation: "LA", population: 120000 },
      { name: "Lake Charles", stateName: "Louisiana", stateAbbreviation: "LA", population: 78000 },
      { name: "Bossier City", stateName: "Louisiana", stateAbbreviation: "LA", population: 68000 },
      // Mississippi additions
      { name: "Gulfport", stateName: "Mississippi", stateAbbreviation: "MS", population: 72000 },
      { name: "Southaven", stateName: "Mississippi", stateAbbreviation: "MS", population: 54000 },
      { name: "Hattiesburg", stateName: "Mississippi", stateAbbreviation: "MS", population: 48000 },
      // Alabama additions
      { name: "Tuscaloosa", stateName: "Alabama", stateAbbreviation: "AL", population: 100000 },
      { name: "Hoover", stateName: "Alabama", stateAbbreviation: "AL", population: 92000 },
      { name: "Dothan", stateName: "Alabama", stateAbbreviation: "AL", population: 71000 },
      { name: "Auburn", stateName: "Alabama", stateAbbreviation: "AL", population: 75000 },
      { name: "Decatur", stateName: "Alabama", stateAbbreviation: "AL", population: 54000 },
      { name: "Madison", stateName: "Alabama", stateAbbreviation: "AL", population: 48000 },
      // Georgia additions
      { name: "Sandy Springs", stateName: "Georgia", stateAbbreviation: "GA", population: 106000 },
      { name: "Roswell", stateName: "Georgia", stateAbbreviation: "GA", population: 95000 },
      { name: "Johns Creek", stateName: "Georgia", stateAbbreviation: "GA", population: 83000 },
      { name: "Albany", stateName: "Georgia", stateAbbreviation: "GA", population: 73000 },
      { name: "Warner Robins", stateName: "Georgia", stateAbbreviation: "GA", population: 80000 },
      { name: "Alpharetta", stateName: "Georgia", stateAbbreviation: "GA", population: 67000 },
      { name: "Marietta", stateName: "Georgia", stateAbbreviation: "GA", population: 60000 },
      { name: "Valdosta", stateName: "Georgia", stateAbbreviation: "GA", population: 57000 },
      { name: "Smyrna", stateName: "Georgia", stateAbbreviation: "GA", population: 56000 },
      // Tennessee additions
      { name: "Johnson City", stateName: "Tennessee", stateAbbreviation: "TN", population: 67000 },
      { name: "Kingsport", stateName: "Tennessee", stateAbbreviation: "TN", population: 54000 },
      { name: "Jackson", stateName: "Tennessee", stateAbbreviation: "TN", population: 68000 },
      { name: "Franklin", stateName: "Tennessee", stateAbbreviation: "TN", population: 83000 },
      { name: "Hendersonville", stateName: "Tennessee", stateAbbreviation: "TN", population: 62000 },
      // Indiana additions
      { name: "Carmel", stateName: "Indiana", stateAbbreviation: "IN", population: 101000 },
      { name: "Fishers", stateName: "Indiana", stateAbbreviation: "IN", population: 100000 },
      { name: "Hammond", stateName: "Indiana", stateAbbreviation: "IN", population: 77000 },
      { name: "Gary", stateName: "Indiana", stateAbbreviation: "IN", population: 69000 },
      { name: "Muncie", stateName: "Indiana", stateAbbreviation: "IN", population: 65000 },
      { name: "Bloomington", stateName: "Indiana", stateAbbreviation: "IN", population: 79000 },
      { name: "Lafayette", stateName: "Indiana", stateAbbreviation: "IN", population: 71000 },
      { name: "Terre Haute", stateName: "Indiana", stateAbbreviation: "IN", population: 59000 },
      // Kentucky additions
      { name: "Bowling Green", stateName: "Kentucky", stateAbbreviation: "KY", population: 72000 },
      { name: "Owensboro", stateName: "Kentucky", stateAbbreviation: "KY", population: 60000 },
      // Ohio additions
      { name: "Parma", stateName: "Ohio", stateAbbreviation: "OH", population: 79000 },
      { name: "Canton", stateName: "Ohio", stateAbbreviation: "OH", population: 70000 },
      { name: "Lorain", stateName: "Ohio", stateAbbreviation: "OH", population: 63000 },
      { name: "Hamilton", stateName: "Ohio", stateAbbreviation: "OH", population: 63000 },
      { name: "Springfield", stateName: "Ohio", stateAbbreviation: "OH", population: 58000 },
      { name: "Kettering", stateName: "Ohio", stateAbbreviation: "OH", population: 56000 },
      { name: "Elyria", stateName: "Ohio", stateAbbreviation: "OH", population: 54000 },
      { name: "Lakewood", stateName: "Ohio", stateAbbreviation: "OH", population: 51000 },
      { name: "Youngstown", stateName: "Ohio", stateAbbreviation: "OH", population: 60000 },
      // Michigan additions
      { name: "Detroit", stateName: "Michigan", stateAbbreviation: "MI", population: 620000 },
      { name: "Ann Arbor", stateName: "Michigan", stateAbbreviation: "MI", population: 121000 },
      { name: "Dearborn", stateName: "Michigan", stateAbbreviation: "MI", population: 109000 },
      { name: "Livonia", stateName: "Michigan", stateAbbreviation: "MI", population: 95000 },
      { name: "Westland", stateName: "Michigan", stateAbbreviation: "MI", population: 82000 },
      { name: "Troy", stateName: "Michigan", stateAbbreviation: "MI", population: 82000 },
      { name: "Kalamazoo", stateName: "Michigan", stateAbbreviation: "MI", population: 72000 },
      { name: "Pontiac", stateName: "Michigan", stateAbbreviation: "MI", population: 61000 },
      { name: "Southfield", stateName: "Michigan", stateAbbreviation: "MI", population: 73000 },
      { name: "Dearborn Heights", stateName: "Michigan", stateAbbreviation: "MI", population: 57000 },
      // Wisconsin additions
      { name: "Milwaukee", stateName: "Wisconsin", stateAbbreviation: "WI", population: 577000 },
      { name: "Green Bay", stateName: "Wisconsin", stateAbbreviation: "WI", population: 107000 },
      { name: "Kenosha", stateName: "Wisconsin", stateAbbreviation: "WI", population: 100000 },
      { name: "Racine", stateName: "Wisconsin", stateAbbreviation: "WI", population: 77000 },
      { name: "Appleton", stateName: "Wisconsin", stateAbbreviation: "WI", population: 76000 },
      { name: "Waukesha", stateName: "Wisconsin", stateAbbreviation: "WI", population: 72000 },
      { name: "Oshkosh", stateName: "Wisconsin", stateAbbreviation: "WI", population: 66000 },
      { name: "Eau Claire", stateName: "Wisconsin", stateAbbreviation: "WI", population: 69000 },
      { name: "Janesville", stateName: "Wisconsin", stateAbbreviation: "WI", population: 65000 },
      { name: "La Crosse", stateName: "Wisconsin", stateAbbreviation: "WI", population: 52000 },
      { name: "Sheboygan", stateName: "Wisconsin", stateAbbreviation: "WI", population: 50000 },
      // Minnesota additions
      { name: "Duluth", stateName: "Minnesota", stateAbbreviation: "MN", population: 90000 },
      { name: "Bloomington", stateName: "Minnesota", stateAbbreviation: "MN", population: 89000 },
      { name: "Brooklyn Park", stateName: "Minnesota", stateAbbreviation: "MN", population: 86000 },
      { name: "Plymouth", stateName: "Minnesota", stateAbbreviation: "MN", population: 81000 },
      { name: "Maple Grove", stateName: "Minnesota", stateAbbreviation: "MN", population: 72000 },
      { name: "Woodbury", stateName: "Minnesota", stateAbbreviation: "MN", population: 75000 },
      // Iowa additions
      { name: "Sioux City", stateName: "Iowa", stateAbbreviation: "IA", population: 83000 },
      { name: "Davenport", stateName: "Iowa", stateAbbreviation: "IA", population: 101000 },
      { name: "Waterloo", stateName: "Iowa", stateAbbreviation: "IA", population: 68000 },
      // North Dakota
      { name: "Fargo", stateName: "North Dakota", stateAbbreviation: "ND", population: 125000 },
      { name: "Bismarck", stateName: "North Dakota", stateAbbreviation: "ND", population: 74000 },
      { name: "Grand Forks", stateName: "North Dakota", stateAbbreviation: "ND", population: 57000 },
      // South Dakota
      { name: "Sioux Falls", stateName: "South Dakota", stateAbbreviation: "SD", population: 196000 },
      { name: "Rapid City", stateName: "South Dakota", stateAbbreviation: "SD", population: 78000 },
      // Montana
      { name: "Billings", stateName: "Montana", stateAbbreviation: "MT", population: 119000 },
      { name: "Missoula", stateName: "Montana", stateAbbreviation: "MT", population: 75000 },
      { name: "Great Falls", stateName: "Montana", stateAbbreviation: "MT", population: 58000 },
      // Wyoming
      { name: "Cheyenne", stateName: "Wyoming", stateAbbreviation: "WY", population: 64000 },
      { name: "Casper", stateName: "Wyoming", stateAbbreviation: "WY", population: 58000 },
      // West Virginia
      { name: "Charleston", stateName: "West Virginia", stateAbbreviation: "WV", population: 48000 },
      { name: "Huntington", stateName: "West Virginia", stateAbbreviation: "WV", population: 46000 },
      // New Hampshire
      { name: "Manchester", stateName: "New Hampshire", stateAbbreviation: "NH", population: 115000 },
      { name: "Nashua", stateName: "New Hampshire", stateAbbreviation: "NH", population: 90000 },
      // Maine
      { name: "Portland", stateName: "Maine", stateAbbreviation: "ME", population: 68000 },
      // Rhode Island additions
      { name: "Cranston", stateName: "Rhode Island", stateAbbreviation: "RI", population: 82000 },
      { name: "Warwick", stateName: "Rhode Island", stateAbbreviation: "RI", population: 82000 },
      // Vermont
      { name: "Burlington", stateName: "Vermont", stateAbbreviation: "VT", population: 45000 },

      // ── TOP-LEVEL CITIES PREVIOUSLY MISSING ──────────────────────────────
      { name: "Washington", stateName: "District of Columbia", stateAbbreviation: "DC", population: 712000 },
      { name: "Baltimore", stateName: "Maryland", stateAbbreviation: "MD", population: 580000 },
      { name: "Boston", stateName: "Massachusetts", stateAbbreviation: "MA", population: 675000 },
      { name: "El Paso", stateName: "Texas", stateAbbreviation: "TX", population: 678000 },
      { name: "Virginia Beach", stateName: "Virginia", stateAbbreviation: "VA", population: 455000 },
      { name: "Honolulu", stateName: "Hawaii", stateAbbreviation: "HI", population: 350000 },
      { name: "Long Beach", stateName: "California", stateAbbreviation: "CA", population: 466000 },
      { name: "Sacramento", stateName: "California", stateAbbreviation: "CA", population: 524000 },

      // ── TEXAS ────────────────────────────────────────────────────────────
      { name: "Allen", stateName: "Texas", stateAbbreviation: "TX", population: 105000 },
      { name: "Round Rock", stateName: "Texas", stateAbbreviation: "TX", population: 133000 },
      { name: "Sugar Land", stateName: "Texas", stateAbbreviation: "TX", population: 118000 },
      { name: "Pearland", stateName: "Texas", stateAbbreviation: "TX", population: 130000 },
      { name: "Lewisville", stateName: "Texas", stateAbbreviation: "TX", population: 110000 },
      { name: "Carrollton", stateName: "Texas", stateAbbreviation: "TX", population: 135000 },
      { name: "College Station", stateName: "Texas", stateAbbreviation: "TX", population: 120000 },
      { name: "Wichita Falls", stateName: "Texas", stateAbbreviation: "TX", population: 104000 },
      { name: "Tyler", stateName: "Texas", stateAbbreviation: "TX", population: 107000 },
      { name: "League City", stateName: "Texas", stateAbbreviation: "TX", population: 110000 },
      { name: "Richardson", stateName: "Texas", stateAbbreviation: "TX", population: 119000 },
      { name: "Edinburg", stateName: "Texas", stateAbbreviation: "TX", population: 100000 },
      { name: "Amarillo", stateName: "Texas", stateAbbreviation: "TX", population: 200000 },
      { name: "Laredo", stateName: "Texas", stateAbbreviation: "TX", population: 261000 },
      { name: "Corpus Christi", stateName: "Texas", stateAbbreviation: "TX", population: 317000 },
      { name: "Garland", stateName: "Texas", stateAbbreviation: "TX", population: 242000 },
      { name: "Lubbock", stateName: "Texas", stateAbbreviation: "TX", population: 264000 },
      { name: "Irving", stateName: "Texas", stateAbbreviation: "TX", population: 240000 },
      { name: "Midland", stateName: "Texas", stateAbbreviation: "TX", population: 132000 },
      { name: "Odessa", stateName: "Texas", stateAbbreviation: "TX", population: 114000 },
      { name: "Abilene", stateName: "Texas", stateAbbreviation: "TX", population: 122000 },
      { name: "Beaumont", stateName: "Texas", stateAbbreviation: "TX", population: 116000 },
      { name: "Killeen", stateName: "Texas", stateAbbreviation: "TX", population: 153000 },
      { name: "Waco", stateName: "Texas", stateAbbreviation: "TX", population: 139000 },
      { name: "Grand Prairie", stateName: "Texas", stateAbbreviation: "TX", population: 196000 },
      { name: "McKinney", stateName: "Texas", stateAbbreviation: "TX", population: 195000 },
      { name: "Frisco", stateName: "Texas", stateAbbreviation: "TX", population: 200000 },
      { name: "Denton", stateName: "Texas", stateAbbreviation: "TX", population: 148000 },
      { name: "Pasadena", stateName: "Texas", stateAbbreviation: "TX", population: 151000 },
      { name: "Brownsville", stateName: "Texas", stateAbbreviation: "TX", population: 183000 },
      { name: "McAllen", stateName: "Texas", stateAbbreviation: "TX", population: 143000 },
      { name: "Mesquite", stateName: "Texas", stateAbbreviation: "TX", population: 143000 },
      { name: "San Angelo", stateName: "Texas", stateAbbreviation: "TX", population: 100000 },
      { name: "Longview", stateName: "Texas", stateAbbreviation: "TX", population: 82000 },
      { name: "Baytown", stateName: "Texas", stateAbbreviation: "TX", population: 78000 },
      { name: "Pharr", stateName: "Texas", stateAbbreviation: "TX", population: 77000 },
      { name: "Temple", stateName: "Texas", stateAbbreviation: "TX", population: 76000 },
      { name: "Missouri City", stateName: "Texas", stateAbbreviation: "TX", population: 75000 },
      { name: "Harlingen", stateName: "Texas", stateAbbreviation: "TX", population: 73000 },
      { name: "New Braunfels", stateName: "Texas", stateAbbreviation: "TX", population: 90000 },
      { name: "Conroe", stateName: "Texas", stateAbbreviation: "TX", population: 91000 },
      { name: "Bryan", stateName: "Texas", stateAbbreviation: "TX", population: 86000 },
      { name: "Flower Mound", stateName: "Texas", stateAbbreviation: "TX", population: 78000 },
      { name: "Mansfield", stateName: "Texas", stateAbbreviation: "TX", population: 72000 },
      { name: "Rowlett", stateName: "Texas", stateAbbreviation: "TX", population: 62000 },
      { name: "Cedar Park", stateName: "Texas", stateAbbreviation: "TX", population: 77000 },
      { name: "Georgetown", stateName: "Texas", stateAbbreviation: "TX", population: 75000 },
      { name: "Mission", stateName: "Texas", stateAbbreviation: "TX", population: 84000 },
      { name: "Atascocita", stateName: "Texas", stateAbbreviation: "TX", population: 65000 },
      { name: "El Paso", stateName: "Texas", stateAbbreviation: "TX", population: 678000 },
      { name: "Arlington", stateName: "Texas", stateAbbreviation: "TX", population: 394000 },
      { name: "Plano", stateName: "Texas", stateAbbreviation: "TX", population: 290000 },
      { name: "Irving", stateName: "Texas", stateAbbreviation: "TX", population: 240000 },

      // ── FLORIDA ──────────────────────────────────────────────────────────
      { name: "Port St. Lucie", stateName: "Florida", stateAbbreviation: "FL", population: 230000 },
      { name: "Lakeland", stateName: "Florida", stateAbbreviation: "FL", population: 120000 },
      { name: "Palm Bay", stateName: "Florida", stateAbbreviation: "FL", population: 120000 },
      { name: "Sunrise", stateName: "Florida", stateAbbreviation: "FL", population: 95000 },
      { name: "Plantation", stateName: "Florida", stateAbbreviation: "FL", population: 91000 },
      { name: "Deltona", stateName: "Florida", stateAbbreviation: "FL", population: 90000 },
      { name: "Davie", stateName: "Florida", stateAbbreviation: "FL", population: 105000 },
      { name: "Boca Raton", stateName: "Florida", stateAbbreviation: "FL", population: 97000 },
      { name: "Pompano Beach", stateName: "Florida", stateAbbreviation: "FL", population: 112000 },
      { name: "Clearwater", stateName: "Florida", stateAbbreviation: "FL", population: 117000 },
      { name: "Gainesville", stateName: "Florida", stateAbbreviation: "FL", population: 143000 },
      { name: "Miramar", stateName: "Florida", stateAbbreviation: "FL", population: 140000 },
      { name: "Pembroke Pines", stateName: "Florida", stateAbbreviation: "FL", population: 165000 },
      { name: "Hollywood", stateName: "Florida", stateAbbreviation: "FL", population: 153000 },
      { name: "Coral Springs", stateName: "Florida", stateAbbreviation: "FL", population: 134000 },
      { name: "St. Petersburg", stateName: "Florida", stateAbbreviation: "FL", population: 265000 },
      { name: "Daytona Beach", stateName: "Florida", stateAbbreviation: "FL", population: 70000 },
      { name: "Spring Hill", stateName: "Florida", stateAbbreviation: "FL", population: 113000 },
      { name: "Deerfield Beach", stateName: "Florida", stateAbbreviation: "FL", population: 80000 },
      { name: "Boynton Beach", stateName: "Florida", stateAbbreviation: "FL", population: 79000 },
      { name: "Lauderhill", stateName: "Florida", stateAbbreviation: "FL", population: 71000 },
      { name: "Weston", stateName: "Florida", stateAbbreviation: "FL", population: 67000 },
      { name: "Fort Myers", stateName: "Florida", stateAbbreviation: "FL", population: 82000 },
      { name: "Homestead", stateName: "Florida", stateAbbreviation: "FL", population: 75000 },
      { name: "Kissimmee", stateName: "Florida", stateAbbreviation: "FL", population: 76000 },
      { name: "Doral", stateName: "Florida", stateAbbreviation: "FL", population: 72000 },
      { name: "Melbourne", stateName: "Florida", stateAbbreviation: "FL", population: 83000 },
      { name: "Pompano Beach", stateName: "Florida", stateAbbreviation: "FL", population: 112000 },
      { name: "Largo", stateName: "Florida", stateAbbreviation: "FL", population: 82000 },
      { name: "North Port", stateName: "Florida", stateAbbreviation: "FL", population: 75000 },
      { name: "Palm Coast", stateName: "Florida", stateAbbreviation: "FL", population: 81000 },
      { name: "Ocala", stateName: "Florida", stateAbbreviation: "FL", population: 63000 },
      { name: "Sanford", stateName: "Florida", stateAbbreviation: "FL", population: 60000 },

      // ── NEW YORK ─────────────────────────────────────────────────────────
      { name: "Albany", stateName: "New York", stateAbbreviation: "NY", population: 99000 },
      { name: "Utica", stateName: "New York", stateAbbreviation: "NY", population: 61000 },
      { name: "Schenectady", stateName: "New York", stateAbbreviation: "NY", population: 66000 },
      { name: "New Rochelle", stateName: "New York", stateAbbreviation: "NY", population: 79000 },
      { name: "Mount Vernon", stateName: "New York", stateAbbreviation: "NY", population: 68000 },
      { name: "White Plains", stateName: "New York", stateAbbreviation: "NY", population: 58000 },
      { name: "Troy", stateName: "New York", stateAbbreviation: "NY", population: 50000 },
      { name: "Binghamton", stateName: "New York", stateAbbreviation: "NY", population: 47000 },

      // ── PENNSYLVANIA ─────────────────────────────────────────────────────
      { name: "Allentown", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 125000 },
      { name: "Reading", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 95000 },
      { name: "Bethlehem", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 75000 },
      { name: "Scranton", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 76000 },
      { name: "Lancaster", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 59000 },
      { name: "Levittown", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 52000 },
      { name: "Harrisburg", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 50000 },
      { name: "Altoona", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 44000 },

      // ── MARYLAND ─────────────────────────────────────────────────────────
      { name: "Frederick", stateName: "Maryland", stateAbbreviation: "MD", population: 78000 },
      { name: "Gaithersburg", stateName: "Maryland", stateAbbreviation: "MD", population: 68000 },
      { name: "Rockville", stateName: "Maryland", stateAbbreviation: "MD", population: 68000 },
      { name: "Bowie", stateName: "Maryland", stateAbbreviation: "MD", population: 58000 },
      { name: "Annapolis", stateName: "Maryland", stateAbbreviation: "MD", population: 40000 },
      { name: "College Park", stateName: "Maryland", stateAbbreviation: "MD", population: 32000 },
      { name: "Hagerstown", stateName: "Maryland", stateAbbreviation: "MD", population: 40000 },

      // ── VIRGINIA ─────────────────────────────────────────────────────────
      { name: "Arlington", stateName: "Virginia", stateAbbreviation: "VA", population: 238000 },
      { name: "Roanoke", stateName: "Virginia", stateAbbreviation: "VA", population: 99000 },
      { name: "Lynchburg", stateName: "Virginia", stateAbbreviation: "VA", population: 82000 },
      { name: "Charlottesville", stateName: "Virginia", stateAbbreviation: "VA", population: 47000 },
      { name: "Suffolk", stateName: "Virginia", stateAbbreviation: "VA", population: 95000 },
      { name: "Portsmouth", stateName: "Virginia", stateAbbreviation: "VA", population: 95000 },

      // ── MASSACHUSETTS ────────────────────────────────────────────────────
      { name: "Springfield", stateName: "Massachusetts", stateAbbreviation: "MA", population: 155000 },
      { name: "Lowell", stateName: "Massachusetts", stateAbbreviation: "MA", population: 115000 },
      { name: "Cambridge", stateName: "Massachusetts", stateAbbreviation: "MA", population: 118000 },
      { name: "Brockton", stateName: "Massachusetts", stateAbbreviation: "MA", population: 105000 },
      { name: "Quincy", stateName: "Massachusetts", stateAbbreviation: "MA", population: 94000 },
      { name: "Lynn", stateName: "Massachusetts", stateAbbreviation: "MA", population: 95000 },
      { name: "New Bedford", stateName: "Massachusetts", stateAbbreviation: "MA", population: 95000 },
      { name: "Fall River", stateName: "Massachusetts", stateAbbreviation: "MA", population: 94000 },
      { name: "Newton", stateName: "Massachusetts", stateAbbreviation: "MA", population: 87000 },
      { name: "Somerville", stateName: "Massachusetts", stateAbbreviation: "MA", population: 81000 },
      { name: "Lawrence", stateName: "Massachusetts", stateAbbreviation: "MA", population: 80000 },
      { name: "Waltham", stateName: "Massachusetts", stateAbbreviation: "MA", population: 62000 },
      { name: "Haverhill", stateName: "Massachusetts", stateAbbreviation: "MA", population: 65000 },
      { name: "Malden", stateName: "Massachusetts", stateAbbreviation: "MA", population: 60000 },
      { name: "Medford", stateName: "Massachusetts", stateAbbreviation: "MA", population: 57000 },
      { name: "Taunton", stateName: "Massachusetts", stateAbbreviation: "MA", population: 57000 },
      { name: "Revere", stateName: "Massachusetts", stateAbbreviation: "MA", population: 53000 },
      { name: "Chicopee", stateName: "Massachusetts", stateAbbreviation: "MA", population: 55000 },

      // ── NEW JERSEY ───────────────────────────────────────────────────────
      { name: "Toms River", stateName: "New Jersey", stateAbbreviation: "NJ", population: 93000 },
      { name: "Trenton", stateName: "New Jersey", stateAbbreviation: "NJ", population: 90000 },
      { name: "Clifton", stateName: "New Jersey", stateAbbreviation: "NJ", population: 85000 },
      { name: "Camden", stateName: "New Jersey", stateAbbreviation: "NJ", population: 74000 },
      { name: "Brick", stateName: "New Jersey", stateAbbreviation: "NJ", population: 75000 },
      { name: "Cherry Hill", stateName: "New Jersey", stateAbbreviation: "NJ", population: 71000 },
      { name: "Passaic", stateName: "New Jersey", stateAbbreviation: "NJ", population: 70000 },
      { name: "Union City", stateName: "New Jersey", stateAbbreviation: "NJ", population: 67000 },
      { name: "East Orange", stateName: "New Jersey", stateAbbreviation: "NJ", population: 65000 },
      { name: "Bayonne", stateName: "New Jersey", stateAbbreviation: "NJ", population: 65000 },
      { name: "Vineland", stateName: "New Jersey", stateAbbreviation: "NJ", population: 60000 },
      { name: "New Brunswick", stateName: "New Jersey", stateAbbreviation: "NJ", population: 56000 },
      { name: "Hoboken", stateName: "New Jersey", stateAbbreviation: "NJ", population: 50000 },
      { name: "Irvington", stateName: "New Jersey", stateAbbreviation: "NJ", population: 54000 },

      // ── CONNECTICUT ──────────────────────────────────────────────────────
      { name: "Danbury", stateName: "Connecticut", stateAbbreviation: "CT", population: 84000 },
      { name: "Norwalk", stateName: "Connecticut", stateAbbreviation: "CT", population: 91000 },
      { name: "Meriden", stateName: "Connecticut", stateAbbreviation: "CT", population: 60000 },
      { name: "West Haven", stateName: "Connecticut", stateAbbreviation: "CT", population: 55000 },
      { name: "Milford", stateName: "Connecticut", stateAbbreviation: "CT", population: 55000 },

      // ── SOUTH CAROLINA ───────────────────────────────────────────────────
      { name: "Charleston", stateName: "South Carolina", stateAbbreviation: "SC", population: 150000 },
      { name: "North Charleston", stateName: "South Carolina", stateAbbreviation: "SC", population: 120000 },
      { name: "Mount Pleasant", stateName: "South Carolina", stateAbbreviation: "SC", population: 90000 },
      { name: "Rock Hill", stateName: "South Carolina", stateAbbreviation: "SC", population: 75000 },
      { name: "Greenville", stateName: "South Carolina", stateAbbreviation: "SC", population: 70000 },
      { name: "Summerville", stateName: "South Carolina", stateAbbreviation: "SC", population: 52000 },
      { name: "Goose Creek", stateName: "South Carolina", stateAbbreviation: "SC", population: 44000 },
      { name: "Hilton Head Island", stateName: "South Carolina", stateAbbreviation: "SC", population: 40000 },
      { name: "Florence", stateName: "South Carolina", stateAbbreviation: "SC", population: 38000 },
      { name: "Sumter", stateName: "South Carolina", stateAbbreviation: "SC", population: 41000 },
      { name: "Spartanburg", stateName: "South Carolina", stateAbbreviation: "SC", population: 38000 },
      { name: "Anderson", stateName: "South Carolina", stateAbbreviation: "SC", population: 28000 },

      // ── NORTH CAROLINA ───────────────────────────────────────────────────
      { name: "High Point", stateName: "North Carolina", stateAbbreviation: "NC", population: 115000 },
      { name: "Concord", stateName: "North Carolina", stateAbbreviation: "NC", population: 105000 },
      { name: "Wilmington", stateName: "North Carolina", stateAbbreviation: "NC", population: 115000 },
      { name: "Gastonia", stateName: "North Carolina", stateAbbreviation: "NC", population: 78000 },
      { name: "Chapel Hill", stateName: "North Carolina", stateAbbreviation: "NC", population: 61000 },
      { name: "Asheville", stateName: "North Carolina", stateAbbreviation: "NC", population: 94000 },
      { name: "Huntersville", stateName: "North Carolina", stateAbbreviation: "NC", population: 59000 },
      { name: "Jacksonville", stateName: "North Carolina", stateAbbreviation: "NC", population: 70000 },
      { name: "Apex", stateName: "North Carolina", stateAbbreviation: "NC", population: 59000 },
      { name: "Mooresville", stateName: "North Carolina", stateAbbreviation: "NC", population: 45000 },

      // ── ILLINOIS ─────────────────────────────────────────────────────────
      { name: "Joliet", stateName: "Illinois", stateAbbreviation: "IL", population: 149000 },
      { name: "Naperville", stateName: "Illinois", stateAbbreviation: "IL", population: 149000 },
      { name: "Elgin", stateName: "Illinois", stateAbbreviation: "IL", population: 112000 },
      { name: "Waukegan", stateName: "Illinois", stateAbbreviation: "IL", population: 90000 },
      { name: "Cicero", stateName: "Illinois", stateAbbreviation: "IL", population: 83000 },
      { name: "Champaign", stateName: "Illinois", stateAbbreviation: "IL", population: 89000 },
      { name: "Aurora", stateName: "Illinois", stateAbbreviation: "IL", population: 179000 },
      { name: "Bloomington", stateName: "Illinois", stateAbbreviation: "IL", population: 79000 },
      { name: "Decatur", stateName: "Illinois", stateAbbreviation: "IL", population: 70000 },
      { name: "Evanston", stateName: "Illinois", stateAbbreviation: "IL", population: 73000 },
      { name: "Bolingbrook", stateName: "Illinois", stateAbbreviation: "IL", population: 73000 },
      { name: "Schaumburg", stateName: "Illinois", stateAbbreviation: "IL", population: 74000 },
      { name: "Palatine", stateName: "Illinois", stateAbbreviation: "IL", population: 68000 },
      { name: "Skokie", stateName: "Illinois", stateAbbreviation: "IL", population: 65000 },
      { name: "Waukegan", stateName: "Illinois", stateAbbreviation: "IL", population: 90000 },
      { name: "Des Plaines", stateName: "Illinois", stateAbbreviation: "IL", population: 58000 },
      { name: "Orland Park", stateName: "Illinois", stateAbbreviation: "IL", population: 56000 },
      { name: "Oak Lawn", stateName: "Illinois", stateAbbreviation: "IL", population: 56000 },
      { name: "Tinley Park", stateName: "Illinois", stateAbbreviation: "IL", population: 54000 },
      { name: "Berwyn", stateName: "Illinois", stateAbbreviation: "IL", population: 54000 },
      { name: "Peoria", stateName: "Illinois", stateAbbreviation: "IL", population: 113000 },
      { name: "Springfield", stateName: "Illinois", stateAbbreviation: "IL", population: 114000 },

      // ── MINNESOTA ────────────────────────────────────────────────────────
      { name: "St. Cloud", stateName: "Minnesota", stateAbbreviation: "MN", population: 68000 },
      { name: "Coon Rapids", stateName: "Minnesota", stateAbbreviation: "MN", population: 63000 },
      { name: "Eden Prairie", stateName: "Minnesota", stateAbbreviation: "MN", population: 65000 },
      { name: "Burnsville", stateName: "Minnesota", stateAbbreviation: "MN", population: 63000 },
      { name: "Blaine", stateName: "Minnesota", stateAbbreviation: "MN", population: 70000 },
      { name: "Minnetonka", stateName: "Minnesota", stateAbbreviation: "MN", population: 54000 },
      { name: "Apple Valley", stateName: "Minnesota", stateAbbreviation: "MN", population: 55000 },
      { name: "Edina", stateName: "Minnesota", stateAbbreviation: "MN", population: 50000 },
      { name: "Lakeville", stateName: "Minnesota", stateAbbreviation: "MN", population: 68000 },
      { name: "Cottage Grove", stateName: "Minnesota", stateAbbreviation: "MN", population: 38000 },

      // ── IOWA ─────────────────────────────────────────────────────────────
      { name: "Ames", stateName: "Iowa", stateAbbreviation: "IA", population: 67000 },
      { name: "Dubuque", stateName: "Iowa", stateAbbreviation: "IA", population: 60000 },
      { name: "Ankeny", stateName: "Iowa", stateAbbreviation: "IA", population: 67000 },
      { name: "Council Bluffs", stateName: "Iowa", stateAbbreviation: "IA", population: 62000 },
      { name: "West Des Moines", stateName: "Iowa", stateAbbreviation: "IA", population: 68000 },

      // ── IDAHO ────────────────────────────────────────────────────────────
      { name: "Nampa", stateName: "Idaho", stateAbbreviation: "ID", population: 100000 },
      { name: "Meridian", stateName: "Idaho", stateAbbreviation: "ID", population: 130000 },
      { name: "Idaho Falls", stateName: "Idaho", stateAbbreviation: "ID", population: 64000 },
      { name: "Pocatello", stateName: "Idaho", stateAbbreviation: "ID", population: 57000 },
      { name: "Caldwell", stateName: "Idaho", stateAbbreviation: "ID", population: 58000 },
      { name: "Coeur d Alene", stateName: "Idaho", stateAbbreviation: "ID", population: 52000 },
      { name: "Twin Falls", stateName: "Idaho", stateAbbreviation: "ID", population: 50000 },

      // ── HAWAII ───────────────────────────────────────────────────────────
      { name: "Pearl City", stateName: "Hawaii", stateAbbreviation: "HI", population: 47000 },
      { name: "Hilo", stateName: "Hawaii", stateAbbreviation: "HI", population: 44000 },
      { name: "Kailua", stateName: "Hawaii", stateAbbreviation: "HI", population: 40000 },
      { name: "Kaneohe", stateName: "Hawaii", stateAbbreviation: "HI", population: 35000 },

      // ── MISSOURI ─────────────────────────────────────────────────────────
      { name: "St. Peters", stateName: "Missouri", stateAbbreviation: "MO", population: 57000 },
      { name: "Florissant", stateName: "Missouri", stateAbbreviation: "MO", population: 52000 },
      { name: "Joplin", stateName: "Missouri", stateAbbreviation: "MO", population: 51000 },

      // ── MICHIGAN ─────────────────────────────────────────────────────────
      { name: "Lansing", stateName: "Michigan", stateAbbreviation: "MI", population: 112000 },
      { name: "Flint", stateName: "Michigan", stateAbbreviation: "MI", population: 96000 },
      { name: "Clinton", stateName: "Michigan", stateAbbreviation: "MI", population: 100000 },
      { name: "Farmington Hills", stateName: "Michigan", stateAbbreviation: "MI", population: 81000 },
      { name: "Shelby Township", stateName: "Michigan", stateAbbreviation: "MI", population: 74000 },
      { name: "Wyoming", stateName: "Michigan", stateAbbreviation: "MI", population: 72000 },
      { name: "Canton", stateName: "Michigan", stateAbbreviation: "MI", population: 90000 },
      { name: "Macomb", stateName: "Michigan", stateAbbreviation: "MI", population: 88000 },
      { name: "Rochester Hills", stateName: "Michigan", stateAbbreviation: "MI", population: 73000 },

      // ── OHIO ─────────────────────────────────────────────────────────────
      { name: "Cuyahoga Falls", stateName: "Ohio", stateAbbreviation: "OH", population: 49000 },
      { name: "Mentor", stateName: "Ohio", stateAbbreviation: "OH", population: 46000 },
      { name: "Middletown", stateName: "Ohio", stateAbbreviation: "OH", population: 51000 },
      { name: "Newark", stateName: "Ohio", stateAbbreviation: "OH", population: 50000 },
      { name: "Fairborn", stateName: "Ohio", stateAbbreviation: "OH", population: 32000 },
      { name: "Mansfield", stateName: "Ohio", stateAbbreviation: "OH", population: 47000 },

      // ── WISCONSIN ────────────────────────────────────────────────────────
      { name: "West Allis", stateName: "Wisconsin", stateAbbreviation: "WI", population: 60000 },
      { name: "Beloit", stateName: "Wisconsin", stateAbbreviation: "WI", population: 36000 },
      { name: "Manitowoc", stateName: "Wisconsin", stateAbbreviation: "WI", population: 33000 },
      { name: "Fond du Lac", stateName: "Wisconsin", stateAbbreviation: "WI", population: 44000 },
      { name: "New Berlin", stateName: "Wisconsin", stateAbbreviation: "WI", population: 40000 },

      // ── GEORGIA ──────────────────────────────────────────────────────────
      { name: "Gainesville", stateName: "Georgia", stateAbbreviation: "GA", population: 42000 },
      { name: "Peachtree City", stateName: "Georgia", stateAbbreviation: "GA", population: 38000 },
      { name: "Kennesaw", stateName: "Georgia", stateAbbreviation: "GA", population: 34000 },
      { name: "Rome", stateName: "Georgia", stateAbbreviation: "GA", population: 36000 },
      { name: "Columbus", stateName: "Georgia", stateAbbreviation: "GA", population: 195000 },

      // ── TENNESSEE ────────────────────────────────────────────────────────
      { name: "Bartlett", stateName: "Tennessee", stateAbbreviation: "TN", population: 59000 },
      { name: "Brentwood", stateName: "Tennessee", stateAbbreviation: "TN", population: 44000 },
      { name: "Collierville", stateName: "Tennessee", stateAbbreviation: "TN", population: 49000 },
      { name: "Smyrna", stateName: "Tennessee", stateAbbreviation: "TN", population: 52000 },
      { name: "Columbia", stateName: "Tennessee", stateAbbreviation: "TN", population: 38000 },
      { name: "Cookeville", stateName: "Tennessee", stateAbbreviation: "TN", population: 34000 },
      { name: "Cleveland", stateName: "Tennessee", stateAbbreviation: "TN", population: 45000 },
      { name: "Germantown", stateName: "Tennessee", stateAbbreviation: "TN", population: 40000 },
      { name: "Spring Hill", stateName: "Tennessee", stateAbbreviation: "TN", population: 46000 },
      { name: "La Vergne", stateName: "Tennessee", stateAbbreviation: "TN", population: 37000 },

      // ── KENTUCKY ─────────────────────────────────────────────────────────
      { name: "Elizabethtown", stateName: "Kentucky", stateAbbreviation: "KY", population: 31000 },
      { name: "Florence", stateName: "Kentucky", stateAbbreviation: "KY", population: 32000 },
      { name: "Georgetown", stateName: "Kentucky", stateAbbreviation: "KY", population: 37000 },
      { name: "Lexington", stateName: "Kentucky", stateAbbreviation: "KY", population: 323000 },
      { name: "Louisville", stateName: "Kentucky", stateAbbreviation: "KY", population: 641000 },

      // ── INDIANA ──────────────────────────────────────────────────────────
      { name: "Noblesville", stateName: "Indiana", stateAbbreviation: "IN", population: 69000 },
      { name: "Greenwood", stateName: "Indiana", stateAbbreviation: "IN", population: 63000 },
      { name: "Westfield", stateName: "Indiana", stateAbbreviation: "IN", population: 46000 },
      { name: "Anderson", stateName: "Indiana", stateAbbreviation: "IN", population: 54000 },
      { name: "Columbus", stateName: "Indiana", stateAbbreviation: "IN", population: 48000 },
      { name: "Richmond", stateName: "Indiana", stateAbbreviation: "IN", population: 36000 },
      { name: "Kokomo", stateName: "Indiana", stateAbbreviation: "IN", population: 59000 },
      { name: "Mishawaka", stateName: "Indiana", stateAbbreviation: "IN", population: 48000 },

      // ── ALABAMA ──────────────────────────────────────────────────────────
      { name: "Montgomery", stateName: "Alabama", stateAbbreviation: "AL", population: 200000 },
      { name: "Phenix City", stateName: "Alabama", stateAbbreviation: "AL", population: 37000 },
      { name: "Prattville", stateName: "Alabama", stateAbbreviation: "AL", population: 35000 },
      { name: "Gadsden", stateName: "Alabama", stateAbbreviation: "AL", population: 32000 },
      { name: "Vestavia Hills", stateName: "Alabama", stateAbbreviation: "AL", population: 34000 },

      // ── LOUISIANA ────────────────────────────────────────────────────────
      { name: "Kenner", stateName: "Louisiana", stateAbbreviation: "LA", population: 67000 },
      { name: "Metairie", stateName: "Louisiana", stateAbbreviation: "LA", population: 143000 },
      { name: "Slidell", stateName: "Louisiana", stateAbbreviation: "LA", population: 27000 },
      { name: "New Iberia", stateName: "Louisiana", stateAbbreviation: "LA", population: 29000 },

      // ── ARKANSAS ─────────────────────────────────────────────────────────
      { name: "Bentonville", stateName: "Arkansas", stateAbbreviation: "AR", population: 54000 },
      { name: "Pine Bluff", stateName: "Arkansas", stateAbbreviation: "AR", population: 40000 },
      { name: "Texarkana", stateName: "Arkansas", stateAbbreviation: "AR", population: 30000 },
      { name: "Hot Springs", stateName: "Arkansas", stateAbbreviation: "AR", population: 37000 },

      // ── OKLAHOMA ─────────────────────────────────────────────────────────
      { name: "Muskogee", stateName: "Oklahoma", stateAbbreviation: "OK", population: 37000 },
      { name: "Shawnee", stateName: "Oklahoma", stateAbbreviation: "OK", population: 31000 },
      { name: "Bartlesville", stateName: "Oklahoma", stateAbbreviation: "OK", population: 36000 },
      { name: "Yukon", stateName: "Oklahoma", stateAbbreviation: "OK", population: 26000 },
      { name: "Owasso", stateName: "Oklahoma", stateAbbreviation: "OK", population: 36000 },

      // ── KANSAS ───────────────────────────────────────────────────────────
      { name: "Wichita", stateName: "Kansas", stateAbbreviation: "KS", population: 397000 },
      { name: "Leawood", stateName: "Kansas", stateAbbreviation: "KS", population: 35000 },
      { name: "Derby", stateName: "Kansas", stateAbbreviation: "KS", population: 25000 },

      // ── NEBRASKA ─────────────────────────────────────────────────────────
      { name: "Fremont", stateName: "Nebraska", stateAbbreviation: "NE", population: 26000 },
      { name: "North Platte", stateName: "Nebraska", stateAbbreviation: "NE", population: 24000 },
      { name: "Norfolk", stateName: "Nebraska", stateAbbreviation: "NE", population: 24000 },

      // ── NEW MEXICO ───────────────────────────────────────────────────────
      { name: "Roswell", stateName: "New Mexico", stateAbbreviation: "NM", population: 46000 },
      { name: "Farmington", stateName: "New Mexico", stateAbbreviation: "NM", population: 46000 },
      { name: "Clovis", stateName: "New Mexico", stateAbbreviation: "NM", population: 39000 },

      // ── NORTH DAKOTA / SOUTH DAKOTA ──────────────────────────────────────
      { name: "Minot", stateName: "North Dakota", stateAbbreviation: "ND", population: 49000 },
      { name: "Brookings", stateName: "South Dakota", stateAbbreviation: "SD", population: 24000 },
      { name: "Watertown", stateName: "South Dakota", stateAbbreviation: "SD", population: 22000 },

      // ── NEVADA ───────────────────────────────────────────────────────────
      { name: "Henderson", stateName: "Nevada", stateAbbreviation: "NV", population: 320000 },
      { name: "Enterprise", stateName: "Nevada", stateAbbreviation: "NV", population: 108000 },
      { name: "Paradise", stateName: "Nevada", stateAbbreviation: "NV", population: 191000 },
      { name: "Sunrise Manor", stateName: "Nevada", stateAbbreviation: "NV", population: 189000 },

      // ── OREGON ───────────────────────────────────────────────────────────
      { name: "Lake Oswego", stateName: "Oregon", stateAbbreviation: "OR", population: 40000 },
      { name: "Tigard", stateName: "Oregon", stateAbbreviation: "OR", population: 54000 },
      { name: "Aloha", stateName: "Oregon", stateAbbreviation: "OR", population: 53000 },

      // ── WASHINGTON ───────────────────────────────────────────────────────
      { name: "Olympia", stateName: "Washington", stateAbbreviation: "WA", population: 53000 },
      { name: "Auburn", stateName: "Washington", stateAbbreviation: "WA", population: 87000 },
      { name: "Spokane Valley", stateName: "Washington", stateAbbreviation: "WA", population: 100000 },
      { name: "Kirkland", stateName: "Washington", stateAbbreviation: "WA", population: 92000 },
      { name: "Bremerton", stateName: "Washington", stateAbbreviation: "WA", population: 44000 },
      { name: "Walla Walla", stateName: "Washington", stateAbbreviation: "WA", population: 34000 },
      { name: "Wenatchee", stateName: "Washington", stateAbbreviation: "WA", population: 32000 },

      // ── CALIFORNIA (additional) ──────────────────────────────────────────
      { name: "Los Angeles", stateName: "California", stateAbbreviation: "CA", population: 3898000 },
      { name: "San Diego", stateName: "California", stateAbbreviation: "CA", population: 1386000 },
      { name: "San Jose", stateName: "California", stateAbbreviation: "CA", population: 1013000 },
      { name: "San Francisco", stateName: "California", stateAbbreviation: "CA", population: 873000 },
      { name: "Fresno", stateName: "California", stateAbbreviation: "CA", population: 542000 },
      { name: "Bakersfield", stateName: "California", stateAbbreviation: "CA", population: 403000 },
      { name: "Oakland", stateName: "California", stateAbbreviation: "CA", population: 440000 },
      { name: "Anaheim", stateName: "California", stateAbbreviation: "CA", population: 350000 },
      { name: "Santa Ana", stateName: "California", stateAbbreviation: "CA", population: 332000 },
      { name: "Irvine", stateName: "California", stateAbbreviation: "CA", population: 310000 },
      { name: "Riverside", stateName: "California", stateAbbreviation: "CA", population: 320000 },
      { name: "Sunnyvale", stateName: "California", stateAbbreviation: "CA", population: 155000 },
      { name: "Pomona", stateName: "California", stateAbbreviation: "CA", population: 151000 },
      { name: "Torrance", stateName: "California", stateAbbreviation: "CA", population: 147000 },
      { name: "Roseville", stateName: "California", stateAbbreviation: "CA", population: 147000 },
      { name: "Escondido", stateName: "California", stateAbbreviation: "CA", population: 151000 },
      { name: "Pasadena", stateName: "California", stateAbbreviation: "CA", population: 138000 },
      { name: "Compton", stateName: "California", stateAbbreviation: "CA", population: 97000 },
      { name: "Orange", stateName: "California", stateAbbreviation: "CA", population: 136000 },
      { name: "Fullerton", stateName: "California", stateAbbreviation: "CA", population: 143000 },
      { name: "Berkeley", stateName: "California", stateAbbreviation: "CA", population: 124000 },
      { name: "Clovis", stateName: "California", stateAbbreviation: "CA", population: 120000 },
      { name: "Murrieta", stateName: "California", stateAbbreviation: "CA", population: 119000 },
      { name: "San Bernardino", stateName: "California", stateAbbreviation: "CA", population: 222000 },
      { name: "Daly City", stateName: "California", stateAbbreviation: "CA", population: 107000 },
      { name: "Westminster", stateName: "California", stateAbbreviation: "CA", population: 91000 },
      { name: "Visalia", stateName: "California", stateAbbreviation: "CA", population: 141000 },
      { name: "Thousand Oaks", stateName: "California", stateAbbreviation: "CA", population: 128000 },
      { name: "Concord", stateName: "California", stateAbbreviation: "CA", population: 128000 },
      { name: "Santa Clara", stateName: "California", stateAbbreviation: "CA", population: 127000 },
      { name: "Simi Valley", stateName: "California", stateAbbreviation: "CA", population: 125000 },
      { name: "Salinas", stateName: "California", stateAbbreviation: "CA", population: 157000 },
      { name: "Hayward", stateName: "California", stateAbbreviation: "CA", population: 162000 },
      { name: "Oxnard", stateName: "California", stateAbbreviation: "CA", population: 203000 },
      { name: "Santa Rosa", stateName: "California", stateAbbreviation: "CA", population: 178000 },
      { name: "Glendale", stateName: "California", stateAbbreviation: "CA", population: 196000 },
      { name: "Rancho Cucamonga", stateName: "California", stateAbbreviation: "CA", population: 177000 },
      { name: "Elk Grove", stateName: "California", stateAbbreviation: "CA", population: 177000 },
      { name: "Oceanside", stateName: "California", stateAbbreviation: "CA", population: 175000 },
      { name: "Moreno Valley", stateName: "California", stateAbbreviation: "CA", population: 213000 },
      { name: "Fontana", stateName: "California", stateAbbreviation: "CA", population: 214000 },
      { name: "Fremont", stateName: "California", stateAbbreviation: "CA", population: 230000 },
      { name: "Huntington Beach", stateName: "California", stateAbbreviation: "CA", population: 198000 },
      { name: "Modesto", stateName: "California", stateAbbreviation: "CA", population: 218000 },
      { name: "Stockton", stateName: "California", stateAbbreviation: "CA", population: 322000 },
      { name: "Palmdale", stateName: "California", stateAbbreviation: "CA", population: 169000 },
      { name: "Lancaster", stateName: "California", stateAbbreviation: "CA", population: 161000 },
      { name: "Santa Clarita", stateName: "California", stateAbbreviation: "CA", population: 228000 },
      { name: "Corona", stateName: "California", stateAbbreviation: "CA", population: 168000 },
      { name: "Garden Grove", stateName: "California", stateAbbreviation: "CA", population: 171000 },
      { name: "El Monte", stateName: "California", stateAbbreviation: "CA", population: 106000 },
      { name: "Inglewood", stateName: "California", stateAbbreviation: "CA", population: 109000 },
      { name: "Costa Mesa", stateName: "California", stateAbbreviation: "CA", population: 111000 },
      { name: "Victorville", stateName: "California", stateAbbreviation: "CA", population: 134000 },
      { name: "Downey", stateName: "California", stateAbbreviation: "CA", population: 111000 },
      { name: "West Covina", stateName: "California", stateAbbreviation: "CA", population: 106000 },
      { name: "Norwalk", stateName: "California", stateAbbreviation: "CA", population: 103000 },
      { name: "Burbank", stateName: "California", stateAbbreviation: "CA", population: 104000 },
      { name: "El Cajon", stateName: "California", stateAbbreviation: "CA", population: 102000 },
      { name: "Fairfield", stateName: "California", stateAbbreviation: "CA", population: 119000 },
      { name: "Antioch", stateName: "California", stateAbbreviation: "CA", population: 115000 },
      { name: "Richmond", stateName: "California", stateAbbreviation: "CA", population: 116000 },
      { name: "Temecula", stateName: "California", stateAbbreviation: "CA", population: 110000 },
      { name: "Ventura", stateName: "California", stateAbbreviation: "CA", population: 110000 },
      { name: "Santa Barbara", stateName: "California", stateAbbreviation: "CA", population: 91000 },
      { name: "San Mateo", stateName: "California", stateAbbreviation: "CA", population: 104000 },
      { name: "Roseville", stateName: "California", stateAbbreviation: "CA", population: 147000 },
      { name: "Torrance", stateName: "California", stateAbbreviation: "CA", population: 147000 },
      { name: "Alhambra", stateName: "California", stateAbbreviation: "CA", population: 84000 },
      { name: "Hawthorne", stateName: "California", stateAbbreviation: "CA", population: 86000 },
      { name: "Lakewood", stateName: "California", stateAbbreviation: "CA", population: 80000 },
      { name: "Vista", stateName: "California", stateAbbreviation: "CA", population: 102000 },
      { name: "Tracy", stateName: "California", stateAbbreviation: "CA", population: 98000 },
      { name: "San Leandro", stateName: "California", stateAbbreviation: "CA", population: 88000 },
      { name: "Vacaville", stateName: "California", stateAbbreviation: "CA", population: 103000 },
      { name: "Jurupa Valley", stateName: "California", stateAbbreviation: "CA", population: 107000 },
      { name: "Pomona", stateName: "California", stateAbbreviation: "CA", population: 151000 },
      { name: "Escondido", stateName: "California", stateAbbreviation: "CA", population: 151000 },
      { name: "Chico", stateName: "California", stateAbbreviation: "CA", population: 103000 },
      { name: "Indio", stateName: "California", stateAbbreviation: "CA", population: 91000 },
      { name: "South Gate", stateName: "California", stateAbbreviation: "CA", population: 94000 },
      { name: "Hesperia", stateName: "California", stateAbbreviation: "CA", population: 94000 },
      { name: "Clovis", stateName: "California", stateAbbreviation: "CA", population: 120000 },
      { name: "Vallejo", stateName: "California", stateAbbreviation: "CA", population: 121000 },
      { name: "Compton", stateName: "California", stateAbbreviation: "CA", population: 97000 },
      { name: "Orange", stateName: "California", stateAbbreviation: "CA", population: 136000 },
      { name: "Fullerton", stateName: "California", stateAbbreviation: "CA", population: 143000 },
      { name: "Berkeley", stateName: "California", stateAbbreviation: "CA", population: 124000 },

      // ── TEXAS (big metros re-confirm) ─────────────────────────────────────
      { name: "Houston", stateName: "Texas", stateAbbreviation: "TX", population: 2304000 },
      { name: "San Antonio", stateName: "Texas", stateAbbreviation: "TX", population: 1434000 },
      { name: "Dallas", stateName: "Texas", stateAbbreviation: "TX", population: 1304000 },
      { name: "Austin", stateName: "Texas", stateAbbreviation: "TX", population: 961000 },
      { name: "Fort Worth", stateName: "Texas", stateAbbreviation: "TX", population: 918000 },

      // ── ADDITIONAL METRO SUBURBS ACROSS THE U.S. ─────────────────────────
      { name: "Chattanooga", stateName: "Tennessee", stateAbbreviation: "TN", population: 181000 },
      { name: "Jackson", stateName: "Mississippi", stateAbbreviation: "MS", population: 153000 },
      { name: "New Orleans", stateName: "Louisiana", stateAbbreviation: "LA", population: 383000 },
      { name: "Oklahoma City", stateName: "Oklahoma", stateAbbreviation: "OK", population: 700000 },
      { name: "Tulsa", stateName: "Oklahoma", stateAbbreviation: "OK", population: 413000 },
      { name: "Wichita", stateName: "Kansas", stateAbbreviation: "KS", population: 397000 },
      { name: "Minneapolis", stateName: "Minnesota", stateAbbreviation: "MN", population: 429000 },
      { name: "Atlanta", stateName: "Georgia", stateAbbreviation: "GA", population: 524000 },
      { name: "Nashville", stateName: "Tennessee", stateAbbreviation: "TN", population: 730000 },
      { name: "Memphis", stateName: "Tennessee", stateAbbreviation: "TN", population: 619000 },
      { name: "Denver", stateName: "Colorado", stateAbbreviation: "CO", population: 748000 },
      { name: "Seattle", stateName: "Washington", stateAbbreviation: "WA", population: 763000 },
      { name: "Portland", stateName: "Oregon", stateAbbreviation: "OR", population: 631000 },
      { name: "Detroit", stateName: "Michigan", stateAbbreviation: "MI", population: 620000 },
      { name: "Milwaukee", stateName: "Wisconsin", stateAbbreviation: "WI", population: 577000 },
      { name: "Columbus", stateName: "Ohio", stateAbbreviation: "OH", population: 924000 },
      { name: "Cleveland", stateName: "Ohio", stateAbbreviation: "OH", population: 361000 },
      { name: "Cincinnati", stateName: "Ohio", stateAbbreviation: "OH", population: 309000 },
      { name: "Indianapolis", stateName: "Indiana", stateAbbreviation: "IN", population: 906000 },
      { name: "Louisville", stateName: "Kentucky", stateAbbreviation: "KY", population: 641000 },
      { name: "Charlotte", stateName: "North Carolina", stateAbbreviation: "NC", population: 879000 },
      { name: "Jacksonville", stateName: "Florida", stateAbbreviation: "FL", population: 949000 },
      { name: "Miami", stateName: "Florida", stateAbbreviation: "FL", population: 442000 },
      { name: "Tampa", stateName: "Florida", stateAbbreviation: "FL", population: 399000 },
      { name: "New York", stateName: "New York", stateAbbreviation: "NY", population: 8336000 },
      { name: "Philadelphia", stateName: "Pennsylvania", stateAbbreviation: "PA", population: 1603000 },
      { name: "Phoenix", stateName: "Arizona", stateAbbreviation: "AZ", population: 1720000 },
      { name: "Chicago", stateName: "Illinois", stateAbbreviation: "IL", population: 2696000 },
      { name: "Las Vegas", stateName: "Nevada", stateAbbreviation: "NV", population: 676000 },
      { name: "Albuquerque", stateName: "New Mexico", stateAbbreviation: "NM", population: 564000 },
      { name: "Omaha", stateName: "Nebraska", stateAbbreviation: "NE", population: 486000 },
      { name: "Raleigh", stateName: "North Carolina", stateAbbreviation: "NC", population: 467000 },
      { name: "Colorado Springs", stateName: "Colorado", stateAbbreviation: "CO", population: 478000 },
      { name: "Anchorage", stateName: "Alaska", stateAbbreviation: "AK", population: 291000 },
    ];

    // Deduplicate by (name, stateName) keeping highest-population entry
    const cityMap = new Map<string, typeof rawCities[0]>();
    for (const c of rawCities) {
      const key = `${c.name.toLowerCase()}::${c.stateName.toLowerCase()}`;
      const existing = cityMap.get(key);
      if (!existing || c.population > existing.population) cityMap.set(key, c);
    }

    const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    const items = Array.from(cityMap.values()).map(c => ({
      accountId,
      type: "city" as const,
      name: c.name,
      slug: `${slugify(c.name)}-${c.stateAbbreviation.toLowerCase()}`,
      stateCode: c.stateAbbreviation,
      stateName: c.stateName,
      population: c.population,
      cityTier: c.population >= 500000 ? 1 : c.population >= 100000 ? 2 : 3,
    }));

    const total = items.length;
    const { inserted } = await storage.bulkCreateLocations(accountId, items);
    return res.json({ inserted, skipped: total - inserted });
  });

  app.post("/api/accounts/:accountId/locations/ai-suggest", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: "ANTHROPIC_API_KEY not configured" });
    const { businessType, state, count } = req.body as { businessType?: string; state?: string; count?: number };
    if (!businessType || !state) return res.status(400).json({ error: "businessType and state are required" });
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const r = await ai.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{
          role: "user",
          content: `You are a local SEO strategist. Suggest the best target cities for a local service business to target for SEO.

Business type: ${businessType}
State: ${state}
Number of cities to suggest: ${count || 10}

Return ONLY valid JSON (no markdown):
{
  "suggestions": [
    { "name": "City Name", "stateCode": "TX", "stateName": "Texas", "reason": "Why this city is a good target" }
  ]
}

Choose cities with high population, commercial activity, or strong demand for this service type. Include a mix of major cities and up-and-coming markets.`,
        }],
      });
      const raw = (r.content[0] as any).text.trim();
      const json = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim());
      return res.json(json);
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "AI error" });
    }
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
    try {
      await storage.deleteService((req.params.id as string));
      return res.json({ message: "Deleted" });
    } catch (e: any) {
      console.error("[delete-service]", e.message);
      return res.status(500).json({ message: e.message || "Failed to delete service" });
    }
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

  app.post("/api/accounts/:accountId/industries/ai-suggest", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: "ANTHROPIC_API_KEY not configured" });
    const { name } = req.body as { name?: string };
    if (!name) return res.status(400).json({ error: "name is required" });
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const r = await ai.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: `You are an SEO content strategist. Given an industry name, generate a description and related services for a local service business directory.

Industry: ${name}

Return ONLY valid JSON (no markdown):
{
  "description": "1-2 sentence description of this industry for SEO purposes",
  "relatedServices": ["service1", "service2", "service3", "service4", "service5"]
}`,
        }],
      });
      const raw = (r.content[0] as any).text.trim();
      const json = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim());
      return res.json(json);
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "AI error" });
    }
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

  app.delete("/api/query-clusters/:id", requireAuth, async (req: Request, res: Response) => {
    await storage.deleteQueryCluster((req.params.id as string));
    return res.status(204).send();
  });

  app.post("/api/accounts/:accountId/query-clusters/ai-generate", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ message: "ANTHROPIC_API_KEY not configured" });
    }
    const accountId = req.params.accountId as string;
    const account = await storage.getAccount(accountId);
    if (!account) return res.status(404).json({ message: "Account not found" });

    const [services, existingClusters] = await Promise.all([
      storage.getServices(accountId),
      storage.getQueryClusters(accountId),
    ]);

    const generated = await generateQueryClusters({
      businessName: account.name,
      industry: (account as any).settings?.industry || account.name,
      services: services.map((s: any) => s.name),
      existingClusters: existingClusters.map((c: any) => c.primaryKeyword),
    });

    // Build service name → id map for auto-linking
    const serviceNameToId = new Map(services.map((s: any) => [s.name.toLowerCase(), s.id]));

    // Insert all generated clusters, skip any with duplicate primaryKeyword
    const existingKeywords = new Set(existingClusters.map((c: any) => c.primaryKeyword.toLowerCase()));
    const toInsert = generated
      .filter(c => !existingKeywords.has(c.primaryKeyword.toLowerCase()))
      .map(c => {
        // Auto-assign serviceId: find first service whose name appears in the cluster keyword
        let serviceId: string | null = null;
        const kwLower = c.primaryKeyword.toLowerCase();
        const nameLower = c.name.toLowerCase();
        for (const [svcName, svcId] of serviceNameToId) {
          const words = svcName.split(/\s+/).filter((w: string) => w.length > 3);
          if (kwLower.includes(svcName) || nameLower.includes(svcName) ||
              words.some((w: string) => kwLower.includes(w) || nameLower.includes(w))) {
            serviceId = svcId;
            break;
          }
        }
        return { ...c, accountId, serviceId };
      });

    const inserted = await Promise.all(
      toInsert.map(c => storage.createQueryCluster(c))
    );

    return res.status(201).json({ inserted: inserted.length, clusters: inserted });
  });

  // Fix 3 — Bulk suggest query clusters per service (review before saving)
  app.post("/api/accounts/:accountId/query-clusters/bulk-suggest", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ message: "ANTHROPIC_API_KEY not configured" });
    const accountId = req.params.accountId as string;
    const { services: serviceNames } = z.object({ services: z.array(z.string()).min(1) }).parse(req.body);
    const account = await storage.getAccount(accountId);
    if (!account) return res.status(404).json({ message: "Account not found" });
    const [allServices, existingClusters] = await Promise.all([storage.getServices(accountId), storage.getQueryClusters(accountId)]);
    const existingKeywords = new Set(existingClusters.map((c: any) => c.primaryKeyword.toLowerCase()));
    const serviceNameToId = new Map(allServices.map((s: any) => [s.name.toLowerCase(), s.id]));
    const { generateQueryClusters } = await import("./services/claude");
    const existingKeywordsArr = existingClusters.map((c: any) => c.primaryKeyword);

    // Parallelize all Claude calls — sequential was causing timeouts (8-9s × N services)
    const resultsByService = await Promise.all(
      serviceNames.map(async (svcName) => {
        try {
          const suggested = await generateQueryClusters({
            businessName: account.name,
            industry: (account as any).settings?.industry || account.name,
            services: [svcName],
            existingClusters: existingKeywordsArr,
          });
          const serviceId = serviceNameToId.get(svcName.toLowerCase()) ?? null;
          const clusters = suggested
            .filter(c => !existingKeywords.has(c.primaryKeyword.toLowerCase()))
            .map(c => ({ ...c, accountId, serviceId, serviceName: svcName }));
          return { service: svcName, clusters };
        } catch (_) {
          return { service: svcName, clusters: [] };
        }
      })
    );

    // Deduplicate across services (first occurrence wins)
    const results: Array<{ service: string; clusters: any[] }> = [];
    for (const r of resultsByService) {
      const unique = r.clusters.filter(c => !existingKeywords.has(c.primaryKeyword.toLowerCase()));
      unique.forEach(c => existingKeywords.add(c.primaryKeyword.toLowerCase()));
      results.push({ service: r.service, clusters: unique });
    }
    return res.json({ suggestions: results });
  });

  // Fix 3 — Bulk save approved clusters
  app.post("/api/accounts/:accountId/query-clusters/bulk-save", requireAuth, async (req: Request, res: Response) => {
    const accountId = req.params.accountId as string;
    const { clusters } = z.object({
      clusters: z.array(z.object({
        name: z.string(), intentType: z.string(), primaryKeyword: z.string(),
        secondaryKeywords: z.array(z.string()).optional().default([]),
        searchVolume: z.number().nullable().optional(),
        difficulty: z.number().nullable().optional(),
        serviceId: z.string().nullable().optional(),
      })),
    }).parse(req.body);
    const existingClusters = await storage.getQueryClusters(accountId);
    const existingKeywords = new Set(existingClusters.map((c: any) => c.primaryKeyword.toLowerCase()));
    const toInsert = clusters.filter(c => !existingKeywords.has(c.primaryKeyword.toLowerCase())).map(c => ({ ...c, accountId, serviceId: c.serviceId ?? null, searchVolume: c.searchVolume ?? null, difficulty: c.difficulty ?? null }));
    const inserted = await Promise.all(toInsert.map(c => storage.createQueryCluster(c as any)));
    return res.status(201).json({ saved: inserted.length, clusters: inserted });
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

  app.delete("/api/accounts/:accountId/blueprints", requireAuth, async (req: Request, res: Response) => {
    const count = await storage.bulkDeleteBlueprints(req.params.accountId as string);
    return res.json({ message: `Deleted ${count} blueprint(s)`, count });
  });

  // Fix 2 — Bulk blueprint generation background job
  app.post("/api/accounts/:accountId/blueprints/bulk-generate", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ message: "ANTHROPIC_API_KEY not configured" });
    const accountId = req.params.accountId as string;
    let pageTypes: string[], serviceNames: string[];
    try {
      const parsed = z.object({
        pageTypes: z.array(z.string()).min(1),
        services: z.array(z.string()).optional().default([""]),
      }).parse(req.body);
      pageTypes = parsed.pageTypes;
      serviceNames = parsed.services;
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request body" });
    }
    const account = await storage.getAccount(accountId);
    if (!account) return res.status(404).json({ message: "Account not found" });
    const [brand, industries, accountWebsites] = await Promise.all([
      account ? storage.getBrandProfiles(accountId).then(bs => bs[0]) : Promise.resolve(null),
      storage.getIndustries(accountId),
      storage.getWebsites(accountId),
    ]);
    const jobWebsiteId = accountWebsites[0]?.id;
    if (!jobWebsiteId) return res.status(400).json({ message: "No website found for this account" });
    const businessName = brand?.name || account.name;
    const industry = industries[0]?.name || account.name;
    const combos: Array<{ pageType: string; service: string }> = [];
    for (const pt of pageTypes) for (const svc of (serviceNames.length ? serviceNames : [""])) combos.push({ pageType: pt, service: svc });
    const job = await storage.createGenerationJob({
      accountId, websiteId: jobWebsiteId, name: `Bulk Blueprint Generate (${combos.length} blueprints)`,
      status: "pending", totalPages: combos.length, processedPages: 0, passedPages: 0, failedPages: 0,
      settings: { type: "blueprint_bulk", combos, businessName, industry, progress: combos.map(c => ({ pageType: c.pageType, service: c.service, status: "pending" })) } as any,
    });
    setImmediate(async () => {
      try {
        const { generateBlueprint } = await import("./services/claude");
        const s = (await storage.getGenerationJob(job.id))!.settings as any;
        await storage.updateGenerationJob(job.id, { status: "running", startedAt: new Date() });
        let passed = 0;
        for (let i = 0; i < combos.length; i++) {
          s.progress[i].status = "running";
          await storage.updateGenerationJob(job.id, { settings: s as any });
          try {
            const { pageType, service } = combos[i];
            const gen = await generateBlueprint({ businessName, industry, serviceName: service || undefined, pageType });
            await storage.createBlueprint({ ...gen, accountId, requiredWordCount: gen.requiredWordCount, minPublishScore: gen.minPublishScore as any, faqEnabled: gen.faqEnabled });
            s.progress[i].status = "done";
            passed++;
          } catch (e: any) { s.progress[i].status = "error"; s.progress[i].error = e.message; }
          await storage.updateGenerationJob(job.id, { settings: s as any, processedPages: i + 1, passedPages: passed });
        }
        await storage.updateGenerationJob(job.id, { status: "completed", completedAt: new Date(), passedPages: passed });
      } catch (e: any) {
        await storage.updateGenerationJob(job.id, { status: "failed", completedAt: new Date() });
      }
    });
    return res.json({ jobId: job.id });
  });

  app.get("/api/accounts/:accountId/blueprints/bulk-job/:jobId", requireAuth, async (req: Request, res: Response) => {
    const job = await storage.getGenerationJob(req.params.jobId as string);
    if (!job) return res.status(404).json({ message: "Job not found" });
    const s = job.settings as any;
    const total = s.progress?.length ?? job.totalPages;
    const done = s.progress?.filter((p: any) => p.status === "done" || p.status === "error").length ?? job.processedPages;
    return res.json({ status: job.status, total, done, created: job.passedPages, progress: s.progress ?? [] });
  });

  // ── Pages ─────────────────────────────────────────────────────────────────

  app.get("/api/websites/:websiteId/pages", requireAuth, async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const includeDrafts = req.query.includeDrafts === "true" || req.query.includeDrafts === "1";
    const pageList = await storage.getPages((req.params.websiteId as string), { status, limit, offset, includeDrafts });
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

    // ─── PHASE 7 — Governor 4 enforcement ───────────────────────────────
    // Onboarding drafts on warmup websites must use the override endpoint.
    if (page.isDraft) {
      const website = await storage.getWebsite(page.websiteId);
      if (website?.warmupMode) {
        return res.status(409).json({
          error: "governor_4_locked",
          message: "This page is a draft on a website in warmup mode. Use the override endpoint with explicit acknowledgement.",
          override_endpoint: `/api/websites/${page.websiteId}/pages/${page.id}/publish-override`,
        });
      }
    }

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

    // ─── PHASE 7 — Governor 4 enforcement on bulk publish ───────────────
    // Filter out onboarding drafts (is_draft=true) on warmup websites.
    // Those must use the explicit override endpoint per page.
    const website = await storage.getWebsite(websiteId);
    let toPublish = [...draft, ...review, ...approved];
    let governorBlocked = 0;
    if (website?.warmupMode) {
      const before = toPublish.length;
      toPublish = toPublish.filter((p: any) => !p.isDraft);
      governorBlocked = before - toPublish.length;
      if (governorBlocked > 0) {
        console.log(`[Governor 4] publish-all skipped ${governorBlocked} draft page(s) on warmup website ${website.domain}.`);
      }
    }

    const now = new Date();
    let count = 0;
    for (const p of toPublish) {
      await storage.updatePage(p.id, { status: "published", publishedAt: now });
      count++;
    }

    if (website && count > 0) {
      await storage.updateWebsite(websiteId, {
        publishedPages: (website.publishedPages || 0) + count,
      } as any);
    }

    return res.json({
      published: count,
      ...(governorBlocked > 0 ? { governor_blocked_drafts: governorBlocked, governor_message: "Some draft pages were skipped because the website is in warmup mode. Use the per-page override flow to publish them individually." } : {}),
    });
  });

  // ─── PHASE 7 — Governor 4: Manual Override Lock ────────────────────────
  // Publish a single draft page with admin override. Requires explicit
  // override_acknowledged=true and admin_name. Records the action on the
  // governor_results trail and on the page itself.
  app.post("/api/websites/:id/pages/:pageId/publish-override", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const pageId = req.params.pageId as string;
    const { override_acknowledged, admin_name } = (req.body || {}) as { override_acknowledged?: boolean; admin_name?: string };

    if (!override_acknowledged) {
      return res.status(400).json({ error: "override_required", message: "You must acknowledge the override warning to publish a draft page during warmup." });
    }
    const adminName = (admin_name || (req as any).user?.email || (req as any).user?.id || "unknown").toString().slice(0, 100);

    try {
      const website = await storage.getWebsite(websiteId);
      if (!website) return res.status(404).json({ error: "website_not_found" });

      const page = await storage.getPage(pageId);
      if (!page || page.websiteId !== websiteId) {
        return res.status(404).json({ error: "page_not_found" });
      }
      if (!page.isDraft) {
        return res.status(400).json({ error: "not_a_draft", message: "Only draft pages can be override-published." });
      }
      if (!website.warmupMode) {
        return res.status(400).json({ error: "override_not_required", message: "This website is not in warmup mode — use the regular publish flow." });
      }

      const now = new Date();
      await storage.updatePage(pageId, {
        status: "published",
        isDraft: false,
        draftReason: null,
        publishedAt: now,
        overridePublishedBy: adminName,
        overridePublishedAt: now,
      } as any);

      await storage.updateWebsite(websiteId, {
        publishedPages: (website.publishedPages || 0) + 1,
      } as any);

      try {
        const { recordGovernor4Override } = await import("./services/launch-governors");
        await recordGovernor4Override(websiteId, adminName, [pageId]);
      } catch (err: any) {
        console.error("[Governor 4] Failed to record override (non-fatal):", err?.message);
      }

      console.log(`[Governor 4] Page ${pageId} published via override by '${adminName}' on ${website.domain}.`);
      return res.json({ published: true, pageId, admin: adminName });
    } catch (err: any) {
      console.error("[Governor 4] Override publish failed:", err?.message);
      return res.status(500).json({ error: "override_failed", message: err?.message });
    }
  });

  // ─── PHASE 7 — Admin: Read governor results for a submission ───────────
  app.get("/api/admin/onboarding/:submissionId/governor-results", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const submissionId = req.params.submissionId as string;
    try {
      const [row] = await db
        .select({
          id: onboardingSubmissions.id,
          status: onboardingSubmissions.status,
          websiteId: onboardingSubmissions.websiteId,
          governorResults: onboardingSubmissions.governorResults,
        })
        .from(onboardingSubmissions)
        .where(dEq(onboardingSubmissions.id, submissionId))
        .limit(1);
      if (!row) return res.status(404).json({ error: "not_found" });
      return res.json({
        submission_id: row.id,
        status: row.status,
        website_id: row.websiteId,
        governor_results: row.governorResults || {},
      });
    } catch (err: any) {
      console.error("[admin/governor-results] error:", err?.message);
      return res.status(500).json({ error: "lookup_failed" });
    }
  });

  // ─── PHASE 7 — Admin: Manually trigger launch governors for a website ──
  app.post("/api/admin/websites/:id/run-launch-governors", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    try {
      const { runLaunchGovernors } = await import("./services/launch-governors");
      const result = await runLaunchGovernors(websiteId);
      return res.json(result);
    } catch (err: any) {
      console.error("[admin/run-launch-governors] error:", err?.message);
      return res.status(500).json({ error: "run_failed", message: err?.message });
    }
  });

  // Bulk-prune all draft pages for a website
  app.post("/api/websites/:id/pages/prune-all-drafts", requireAuth, async (req: Request, res: Response) => {
    const websiteId = (req.params.id as string);
    const drafts = await storage.getPages(websiteId, { status: "draft", limit: 100000 });
    for (const p of drafts) {
      await storage.updatePage(p.id, { status: "pruned", pruneReason: "Bulk pruned from draft review" });
    }
    return res.json({ pruned: drafts.length });
  });

  // Prune a page
  app.put("/api/pages/:id/slug", requireAuth, async (req: Request, res: Response) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(req.body);
    const page = await storage.getPage(req.params.id as string);
    if (!page) return res.status(404).json({ message: "Page not found" });
    const existing = await storage.getPageBySlug(page.websiteId, slug);
    if (existing && existing.id !== page.id) return res.status(409).json({ message: "A page with that slug already exists for this website." });
    const updated = await storage.updatePage(req.params.id as string, { slug });
    return res.json(updated);
  });

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
    const job = await storage.getGenerationJob(req.params.id as string);
    const updated = await storage.updateGenerationJob((req.params.id as string), {
      status: "cancelled",
      completedAt: new Date(),
    });
    // Sync the published-pages counter so the UI reflects pages already created
    // before the cancel — without this the counter stays stale and new jobs
    // appear to skip everything even though pages really do exist in the DB.
    if (job?.websiteId) {
      await storage.syncWebsitePublishedCount(job.websiteId).catch(() => {});
    }
    return res.json(updated);
  });

  app.delete("/api/jobs/completed", requireAuth, async (req: Request, res: Response) => {
    const deleted = await storage.deleteCompletedJobs();
    return res.json({ message: `Removed ${deleted} job(s)`, deleted });
  });

  app.post("/api/jobs/delete-batch", requireAuth, async (req: Request, res: Response) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "Provide job ids" });
    const deleted = await storage.deleteJobsByIds(ids);
    return res.json({ message: `Removed ${deleted} job(s)`, deleted });
  });

  app.delete("/api/jobs/:id", requireAuth, async (req: Request, res: Response) => {
    const job = await storage.getGenerationJob(req.params.id as string);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (job.status === "running" || job.status === "pending") {
      return res.status(400).json({ message: "Cannot delete a running or pending job. Cancel it first." });
    }
    await storage.deleteGenerationJob(req.params.id as string);
    return res.json({ message: "Job deleted" });
  });

  // ── Sitemaps ──────────────────────────────────────────────────────────────

  app.get("/api/websites/:websiteId/sitemaps", requireAuth, async (req: Request, res: Response) => {
    // Use meta-only query — xmlContent can be 1MB+ per row (28 rows for large sites = 28MB) and the admin UI never needs it
    return res.json(await storage.getSitemapsMeta((req.params.websiteId as string)));
  });

  app.post("/api/websites/:websiteId/sitemaps/generate", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.getWebsite((req.params.websiteId as string));
    if (!website) return res.status(404).json({ message: "Website not found" });

    // Clear chunk cache so regenerated content is served immediately
    invalidateSitemapCache(req.params.websiteId as string);
    const pDomain = (website.settings as any)?.parentDomain;
    const pPathRaw = ((website.settings as any)?.proxyPath || "") as string;
    const pPath = pPathRaw.startsWith("/sites/") ? "" : pPathRaw;
    const canonBase = pDomain ? `https://${pDomain}${pPath}` : undefined;
    const keys = await generateSitemapsForWebsite((req.params.websiteId as string), website.domain, canonBase);
    return res.json({ message: "Sitemaps generated", keys });
  });

  // Submit existing published pages to Google Indexing API in batches of 200.
  // State hub pages are submitted first (highest SEO priority).
  // Returns { submitted, nextOffset, total } so the UI can track progress day-over-day.
  app.post("/api/websites/:websiteId/submit-to-google", requireAuth, async (req: Request, res: Response) => {
    const { websiteId } = req.params;
    const offset = Number(req.body?.offset ?? 0);
    const BATCH = 200;

    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ message: "Website not found" });

    const { rows, total } = await storage.getPagesForIndexing(websiteId, offset, BATCH);
    if (rows.length === 0) return res.json({ submitted: 0, nextOffset: offset, total, done: true });

    const pDom = (website.settings as any)?.parentDomain;
    const pPthRaw = ((website.settings as any)?.proxyPath || "") as string;
    const pPth = pPthRaw.startsWith("/sites/") ? "" : pPthRaw;
    const idxBase = pDom ? `https://${pDom}${pPth}` : `https://${website.domain}`;
    const urls = rows.map(p => `${idxBase}/${p.slug}`);
    const { submitUrlsToGoogle } = await import("./services/gsc-indexing");
    await submitUrlsToGoogle(urls);

    const nextOffset = offset + rows.length;
    return res.json({ submitted: rows.length, nextOffset, total, done: nextOffset >= total });
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
  // Serves sitemaps, robots.txt and pages at /sites/:domain/:file
  app.get("/sites/:domain/sitemap.xml", async (req: Request, res: Response) => {
    const website = await storage.getWebsiteByDomain(req.params.domain as string);
    if (!website) return res.status(404).send(notFoundHtml("Website not found"));
    const pd = (website.settings as any)?.parentDomain;
    const ppRaw = ((website.settings as any)?.proxyPath || "") as string;
    const pp = ppRaw.startsWith("/sites/") ? "" : ppRaw;
    const base = pd ? `https://${pd}${pp}` : `https://${website.domain}`;
    const sitemapList = await storage.getSitemapsMeta(website.id);
    const today = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (sitemapList.length === 0) {
      const publishedPages = await storage.getPages(website.id, { status: "published", limit: 50000 });
      const urls = publishedPages.map((p) => ({ loc: `${base}/${p.slug}`, lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0], priority: "0.7" }));
      const { buildSitemapXml } = await import("./services/sitemap");
      return res.send(buildSitemapXml(urls));
    }
    const { buildSitemapIndexXml } = await import("./services/sitemap");
    return res.send(buildSitemapIndexXml(sitemapList.map((sm) => ({ loc: `${base}/${sm.slug}.xml`, lastmod: today }))));
  });

  app.get("/sites/:domain/sitemap-:num.xml", async (req: Request, res: Response) => {
    const website = await storage.getWebsiteByDomain(req.params.domain as string);
    if (!website) return res.status(404).send(notFoundHtml("Website not found"));
    const pd = (website.settings as any)?.parentDomain;
    const ppRaw2 = ((website.settings as any)?.proxyPath || "") as string;
    const pp = ppRaw2.startsWith("/sites/") ? "" : ppRaw2;
    const base = pd ? `https://${pd}${pp}` : `https://${website.domain}`;
    const chunkIndex = parseInt(req.params.num, 10) - 1;
    const chunkSlug = `sitemap-${req.params.num}`;
    const cacheKey = `${website.id}:${chunkIndex}`;
    const cached = sitemapChunkCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(cached.xml);
    }
    const record = await storage.getSitemapBySlug(website.id, chunkSlug);
    if (record?.xmlContent) {
      sitemapChunkCache.set(cacheKey, { xml: record.xmlContent, expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS });
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(record.xmlContent);
    }
    const offset = chunkIndex * URLS_PER_SITEMAP;
    const chunk = await storage.getPages(website.id, { status: "published", limit: URLS_PER_SITEMAP, offset });
    const urls = chunk.map((p) => ({ loc: `${base}/${p.slug}`, lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0], priority: (p as any).pageType === "state_hub" ? "0.9" : (p as any).pageType === "city_hub" ? "0.8" : "0.7" }));
    const { buildSitemapXml } = await import("./services/sitemap");
    const xml = buildSitemapXml(urls);
    sitemapChunkCache.set(cacheKey, { xml, expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS });
    storage.updateSitemapXml(website.id, chunkSlug, xml).catch(() => {});
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(xml);
  });

  app.get("/sites/:domain/robots.txt", async (req: Request, res: Response) => {
    const website = await storage.getWebsiteByDomain(req.params.domain as string);
    if (!website) return res.status(404).send(notFoundHtml("Website not found"));
    const pd = (website.settings as any)?.parentDomain;
    const ppRaw3 = ((website.settings as any)?.proxyPath || "") as string;
    const pp = ppRaw3.startsWith("/sites/") ? "" : ppRaw3;
    const sitemapUrl = pd ? `https://${pd}${pp}/sitemap.xml` : `https://${website.domain}/sitemap.xml`;
    const robotsContent = website.robotsTxt || generateRobotsTxt(website.domain, sitemapUrl);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.send(robotsContent);
  });

  app.get("/sites/:domain/:slug", async (req: Request, res: Response) => {
    const website = await storage.getWebsiteByDomain((req.params.domain as string));
    if (!website) return res.status(404).send(notFoundHtml("Website not found"));

    const slug = req.params.slug as string;
    const parentDomain = (website.settings as any)?.parentDomain;
    const proxyPath = (website.settings as any)?.proxyPath || "";
    const canonicalBase = parentDomain ? `https://${parentDomain}${proxyPath}` : `https://${website.domain}`;

    // Sitemap index
    if (slug === "sitemap.xml" || slug === "sitemap_index.xml" || slug === "sitemap") {
      const sitemapList = await storage.getSitemapsMeta(website.id);
      const today = new Date().toISOString().split("T")[0];
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      if (sitemapList.length === 0) {
        const publishedPages = await storage.getPages(website.id, { status: "published", limit: 50000 });
        const urls = publishedPages.map((p) => ({
          loc: `${canonicalBase}/${p.slug}`,
          lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0],
          priority: "0.7",
        }));
        const { buildSitemapXml } = await import("./services/sitemap");
        return res.send(buildSitemapXml(urls));
      }
      const { buildSitemapIndexXml } = await import("./services/sitemap");
      return res.send(buildSitemapIndexXml(
        sitemapList.map((sm) => ({ loc: `${canonicalBase}/${sm.slug}.xml`, lastmod: today }))
      ));
    }

    // Sitemap chunk (e.g. sitemap-1.xml)
    const sitemapChunkMatch = slug.match(/^(sitemap-(\d+))\.xml$/);
    if (sitemapChunkMatch) {
      const chunkIndex = parseInt(sitemapChunkMatch[2], 10) - 1;
      const chunkSlug = sitemapChunkMatch[1];
      const cacheKey = `${website.id}:${chunkIndex}`;
      const cached = sitemapChunkCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.send(cached.xml);
      }
      const record = await storage.getSitemapBySlug(website.id, chunkSlug);
      if (record?.xmlContent) {
        sitemapChunkCache.set(cacheKey, { xml: record.xmlContent, expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS });
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.send(record.xmlContent);
      }
      const offset = chunkIndex * URLS_PER_SITEMAP;
      const chunk = await storage.getPages(website.id, { status: "published", limit: URLS_PER_SITEMAP, offset });
      const urls = chunk.map((p) => ({
        loc: `${canonicalBase}/${p.slug}`,
        lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0],
        priority: (p as any).pageType === "state_hub" ? "0.9" : (p as any).pageType === "city_hub" ? "0.8" : "0.7",
      }));
      const { buildSitemapXml } = await import("./services/sitemap");
      const xml = buildSitemapXml(urls);
      sitemapChunkCache.set(cacheKey, { xml, expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS });
      storage.updateSitemapXml(website.id, chunkSlug, xml).catch(() => {});
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(xml);
    }

    // Robots.txt
    if (slug === "robots.txt") {
      const robotsContent = website.robotsTxt
        || generateRobotsTxt(website.domain, `${canonicalBase}/sitemap.xml`);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(robotsContent);
    }

    // Determine the link base for nav links rendered into the page HTML.
    // For websites with a real proxy path (/pages, etc.): always use the real path.
    //   - On live domains, Cloudflare handles /pages/* correctly.
    //   - In admin preview on sospages.replit.app, the GET /pages/:slug route below
    //     redirects clicks to /sites/domain/slug so navigation still works.
    // For websites served at root level (no proxy path), fall back to /sites/domain
    // in admin preview so clicking nav links works within the Replit admin app.
    const reqHost = (req.hostname || (req.headers.host || "").split(":")[0]).toLowerCase().trim();
    const rawPx = ((website.settings as any)?.proxyPath || "") as string;
    const realProxyPath = rawPx.startsWith("/sites/") ? "" : rawPx;
    const isAdminPreview = reqHost !== req.params.domain.toLowerCase();
    const siteLinkBase = realProxyPath || (isAdminPreview ? `/sites/${req.params.domain}` : "");
    console.log(`[sites-route] slug=${slug} reqHost=${reqHost} isAdminPreview=${isAdminPreview} siteLinkBase=${JSON.stringify(siteLinkBase)}`);

    const page = await storage.getPageBySlug(website.id, slug);
    const brandProfiles = await storage.getBrandProfiles(website.accountId);
    const brand = brandProfiles[0];
    if (!page || page.status !== "published") {
      // Check hub pages first
      const hubPage = await storage.getHubPageBySlug(website.id, slug);
      if (hubPage && hubPage.status === "published" && hubPage.content) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.send(hubPage.content);
      }
      const dynamic = await tryGenerateDynamicPage(slug, website, brand, siteLinkBase || undefined);
      if (dynamic && "redirect" in dynamic) return res.redirect(301, dynamic.redirect);
      if (dynamic && "html" in dynamic) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600");
        console.log(`[dynamic-page] 200 on-the-fly: ${slug}`);
        return res.send(dynamic.html);
      }
      return res.status(404).send(notFoundHtml("Page not found or not yet published"));
    }

    // Get active content version
    const version = await storage.getActivePageVersion(page.id);

    const [statePages, cityPages, stateDisplayName, siblingServices] = await resolveNavData(page, website.id);
    const internalLinks = await storage.getOutboundLinksForPage(page.id);

    const html = renderPageHtml(page, version, website, brand, { statePages, cityPages, stateDisplayName, siblingServices, internalLinks }, siteLinkBase || undefined);
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

  // Root redirect for custom domains — catches GET / before static-file middleware
  // can serve index.html. Checks the Host header; non-matching hosts call next().
  app.get("/", (req: Request, res: Response, next: NextFunction) => {
    const host = (req.hostname || (req.headers.host || "").split(":")[0]).toLowerCase().trim();
    if (host === "subtrackers.spotonresults.com") {
      return res.redirect(301, "https://subtrackers.spotonresults.com/pages/");
    }
    // spotonnexus.com — fall through to Vite/static so React landing page renders
    return next();
  });

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Resolve the actual client-facing hostname.
      // Priority: X-Nexus-Host (set by Cloudflare Worker, survives Replit ingress rewriting)
      // → CF-Custom-Hostname (set by Cloudflare for SaaS on fallback origin requests)
      // → X-Forwarded-Host → req.hostname → raw Host header fallback.
      const nexusHost = ((req.headers["x-nexus-host"] as string) || "").split(",")[0].trim();
      const cfCustomHostname = ((req.headers["cf-custom-hostname"] as string) || "").split(",")[0].trim();
      const xfh = ((req.headers["x-forwarded-host"] as string) || "").split(",")[0].trim();
      const host = (nexusHost || cfCustomHostname || xfh || req.hostname || (req.headers.host || "").split(":")[0]).toLowerCase().trim();

      // Log custom domain requests for non-asset, non-API paths
      if (host && !PLATFORM_SUFFIXES.some(s => host.endsWith(s)) && host !== "localhost" && host !== "0.0.0.0" && !req.path.startsWith("/api/") && !req.path.startsWith("/src/") && !req.path.startsWith("/@") && !req.path.startsWith("/__") && !req.path.match(/\.(js|css|png|ico|svg|woff2?)$/)) {
        console.log(`[domain-mw] host=${host} path=${req.path}`);
      }

      // Skip Replit platform domains, localhost, landing page root, and internal asset paths
      const landingDomain = (process.env.LANDING_DOMAIN || "spotonnexus.com").toLowerCase();
      const isLandingDomain = host === landingDomain || host === `www.${landingDomain}`;
      const isStaticAsset = req.path.startsWith("/assets/") || !!req.path.match(/\.(js|css|png|ico|svg|woff2?|json|txt|webmanifest)$/);
      const isLandingSpaPath = isLandingDomain && (
        req.path === "/" ||
        req.path === "" ||
        isStaticAsset ||
        req.path === "/welcome" ||
        req.path.startsWith("/onboard/") ||
        req.path.startsWith("/dashboard/")
      );
      if (!host
        || host === "localhost"
        || host === "0.0.0.0"
        || isLandingSpaPath
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
      if (!website) {
        console.log(`[domain-mw] no website found for host=${host}`);
        return next(); // unknown domain — fall through to admin app
      }

      // Strip the proxyPath prefix (e.g. /pages) from incoming URLs before slug matching.
      // If the stored proxyPath is an admin-preview-style path (starts with /sites/), ignore
      // it for slug extraction and fall back to detecting the prefix from the URL directly.
      const storedProxyPath = ((website.settings as any)?.proxyPath || "").replace(/\/$/, "");
      const rawProxyPath = storedProxyPath.startsWith("/sites/") ? "" : storedProxyPath;
      let effectivePath = req.path;
      let effectiveLinkBase = rawProxyPath; // used later as linkBaseOverride for renderPageHtml
      if (rawProxyPath && req.path.startsWith(rawProxyPath + "/")) {
        effectivePath = req.path.slice(rawProxyPath.length);
      } else if (rawProxyPath && (req.path === rawProxyPath || req.path === rawProxyPath + "/")) {
        effectivePath = "/";
      } else if (!rawProxyPath) {
        // No valid proxyPath configured — auto-detect from common path prefixes
        const knownPrefixes = ["/pages", "/p"];
        for (const pfx of knownPrefixes) {
          if (req.path.startsWith(pfx + "/")) {
            effectivePath = req.path.slice(pfx.length);
            effectiveLinkBase = pfx;
            break;
          }
        }
      }
      const rawSlug = effectivePath.replace(/^\//, "").replace(/\/$/, "");
      console.log(`[domain-mw] storedProxy=${JSON.stringify(storedProxyPath)} effectiveLinkBase=${JSON.stringify(effectiveLinkBase)} rawSlug=${rawSlug}`);

      // Sitemap — serve inline (Google does not follow redirects for sitemaps)
      if (rawSlug === "sitemap.xml" || rawSlug === "sitemap_index.xml" || rawSlug === "sitemap") {
        const sitemapList = await storage.getSitemapsMeta(website.id);
        const parentDomain = (website.settings as any)?.parentDomain;
        const proxyPath = (website.settings as any)?.proxyPath || "";
        const baseUrl = parentDomain ? `https://${parentDomain}${proxyPath}` : `https://${website.domain}`;
        const today = new Date().toISOString().split("T")[0];
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600");
        if (sitemapList.length === 0) {
          const publishedPages = await storage.getPages(website.id, { status: "published", limit: 50000 });
          const urls = publishedPages.map((p) => ({
            loc: `${baseUrl}/${p.slug}`,
            lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0],
            priority: "0.7",
          }));
          const { buildSitemapXml } = await import("./services/sitemap");
          console.log(`[sitemap] serving inline ${urls.length} urls for ${host}`);
          return res.send(buildSitemapXml(urls));
        }
        const { buildSitemapIndexXml } = await import("./services/sitemap");
        console.log(`[sitemap] serving index with ${sitemapList.length} sitemaps for ${host}`);
        return res.send(buildSitemapIndexXml(
          sitemapList.map((sm) => ({ loc: `${baseUrl}/${sm.slug}.xml`, lastmod: today }))
        ));
      }

      // Individual sitemap files (e.g. /sitemap-1.xml)
      // Serve order: memory cache → stored DB xml → live page query (one-time cost, then stored)
      const sitemapChunkMatch = rawSlug.match(/^(sitemap-(\d+))\.xml$/);
      if (sitemapChunkMatch) {
        const chunkIndex = parseInt(sitemapChunkMatch[2], 10) - 1;
        const cacheKey = `${website.id}:${chunkIndex}`;
        // 1. In-memory cache hit (fastest — sub-ms)
        const cached = sitemapChunkCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          res.setHeader("Content-Type", "application/xml; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=3600");
          return res.send(cached.xml);
        }
        // 2. Stored XML in DB row — single-row lookup by slug (avoids loading all N chunks)
        const chunkSlug = sitemapChunkMatch[1]; // e.g. "sitemap-3"
        const record = await storage.getSitemapBySlug(website.id, chunkSlug);
        if (record?.xmlContent) {
          sitemapChunkCache.set(cacheKey, { xml: record.xmlContent, expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS });
          res.setHeader("Content-Type", "application/xml; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=3600");
          return res.send(record.xmlContent);
        }
        // 3. Not yet stored — build from pages (slow, one-time), then persist to DB for future
        const offset = chunkIndex * URLS_PER_SITEMAP;
        const chunk = await storage.getPages(website.id, { status: "published", limit: URLS_PER_SITEMAP, offset });
        const pDomain = (website.settings as any)?.parentDomain;
        const pPath = (website.settings as any)?.proxyPath || "";
        const baseUrl = pDomain ? `https://${pDomain}${pPath}` : `https://${website.domain}`;
        const urls = chunk.map((p) => ({
          loc: `${baseUrl}/${p.slug}`,
          lastmod: (p.publishedAt || p.updatedAt).toISOString().split("T")[0],
          priority: (p as any).pageType === "state_hub" ? "0.9" : (p as any).pageType === "city_hub" ? "0.8" : "0.7",
        }));
        const { buildSitemapXml } = await import("./services/sitemap");
        const xml = buildSitemapXml(urls);
        sitemapChunkCache.set(cacheKey, { xml, expiresAt: Date.now() + SITEMAP_CACHE_TTL_MS });
        storage.updateSitemapXml(website.id, chunkSlug, xml).catch(() => {});
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.send(xml);
      }

      // Robots.txt — serve inline (no redirect; Google does not follow redirects for robots.txt)
      if (rawSlug === "robots.txt") {
        const rPd = (website.settings as any)?.parentDomain;
        const rPp = (website.settings as any)?.proxyPath || "";
        const sitemapBase = rPd ? `https://${rPd}${rPp}` : `https://${website.domain}`;
        const robotsContent = website.robotsTxt
          || generateRobotsTxt(website.domain, `${sitemapBase}/sitemap.xml`);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.send(robotsContent);
      }

      // subdraw.com root and non-page paths: proxy from landing page at subtrackers.spotonresults.com
      const isSubdrawHost = host === "subdraw.com" || host === "www.subdraw.com";
      async function proxySubdrawLanding(slug: string): Promise<boolean> {
        try {
          const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
          const proxyUrl = `https://subtrackers.spotonresults.com/${slug}${qs}`;
          const proxyRes = await fetch(proxyUrl, { headers: { "User-Agent": req.headers["user-agent"] || "Nexus-Proxy" } });
          const contentType = proxyRes.headers.get("content-type") || "text/html";
          res.setHeader("Content-Type", contentType);
          res.status(proxyRes.status);
          res.send(await proxyRes.text());
          return true;
        } catch (e) {
          console.error(`[subdraw-proxy] error:`, e);
          return false;
        }
      }

      // Root — show a simple page index for the domain
      if (!rawSlug) {
        if (isSubdrawHost) { await proxySubdrawLanding(""); return; }
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
      const brandProfiles = await storage.getBrandProfiles(website.accountId);
      const brand = brandProfiles[0];
      if (!page || page.status !== "published") {
        // Check hub pages before dynamic fallback
        const hubPage = await storage.getHubPageBySlug(website.id, rawSlug);
        if (hubPage && hubPage.status === "published" && hubPage.content) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=3600");
          console.log(`[hub-page] 200 ${host}/${rawSlug}`);
          return res.send(hubPage.content);
        }
        const dynamic = await tryGenerateDynamicPage(rawSlug, website, brand, effectiveLinkBase || undefined);
        if (dynamic && "redirect" in dynamic) return res.redirect(301, dynamic.redirect);
        if (dynamic && "html" in dynamic) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "public, max-age=3600");
          console.log(`[dynamic-page] 200 on-the-fly: ${host}/${rawSlug}`);
          return res.send(dynamic.html);
        }
        if (isSubdrawHost) { await proxySubdrawLanding(rawSlug); return; }
        console.log(`[page-serve] 404 ${host}/${rawSlug} — ${!page ? "not found" : "not published"}`);
        return res.status(404).send(notFoundHtml("Page not found or not yet published"));
      }

      const version = await storage.getActivePageVersion(page.id);
      const [statePages, cityPages, stateDisplayName, siblingServices] = await resolveNavData(page, website.id);
      const internalLinks = await storage.getOutboundLinksForPage(page.id);
      const html = renderPageHtml(page, version, website, brand, { statePages, cityPages, stateDisplayName, siblingServices, internalLinks }, effectiveLinkBase || undefined);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      console.log(`[page-serve] 200 ${host}/${rawSlug}`);
      return res.send(html);
    } catch (err) {
      return next(err);
    }
  });

  // Render /pages/:slug directly — no /sites/ prefix needed.
  // On live custom domains the domain middleware handles this first.
  // On sospages.replit.app (admin preview), the domain middleware skips platform hosts,
  // so this route catches clicks on /pages/slug links and renders the page in-place.
  app.get("/pages/:slug", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await storage.getPageBySlugGlobal(req.params.slug);
      if (!result) return next();
      const { page, website } = result;
      if (page.status !== "published") return next();
      const rawPx = ((website.settings as any)?.proxyPath || "") as string;
      const linkBase = rawPx.startsWith("/sites/") ? "" : rawPx;
      const brandProfiles = await storage.getBrandProfiles(website.accountId);
      const brand = brandProfiles[0];
      const version = await storage.getActivePageVersion(page.id);
      const [statePages, cityPages, stateDisplayName, siblingServices] = await resolveNavData(page, website.id);
      const internalLinks = await storage.getOutboundLinksForPage(page.id);
      const html = renderPageHtml(page, version, website, brand, { statePages, cityPages, stateDisplayName, siblingServices, internalLinks }, linkBase || undefined);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(html);
    } catch (err) {
      return next(err);
    }
  });

  // ── Variation Banks ───────────────────────────────────────────────────────

  app.get("/api/websites/:id/bank-services", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getVariationBankServices(req.params.id as string));
  });

  app.get("/api/websites/:id/variation-services", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const [bankServices, website] = await Promise.all([
      storage.getVariationBankServices(websiteId),
      storage.getWebsite(websiteId),
    ]);
    // Also include services from the account's services table so newly-created services appear
    const accountServices = website
      ? (await storage.getServices(website.accountId)).map((s: any) => s.name)
      : [];
    // Merge: bank services first (preserve order), then any account services not yet in banks
    const merged = Array.from(new Set([...bankServices, ...accountServices]));
    return res.json(merged);
  });

  app.get("/api/websites/:id/context", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.getWebsite(req.params.id as string);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const [brand, industries] = await Promise.all([
      website.brandProfileId ? storage.getBrandProfile(website.brandProfileId) : Promise.resolve(undefined),
      storage.getIndustries(website.accountId),
    ]);
    return res.json({
      brand: brand ? { name: brand.name, description: brand.description, voiceAndTone: brand.voiceAndTone } : null,
      industry: industries[0] ? { name: industries[0].name, description: industries[0].description } : null,
    });
  });

  app.post("/api/websites/:id/variation-banks/write", requireAuth, async (req: Request, res: Response) => {
    const { service } = z.object({ service: z.string().min(1) }).parse(req.body);
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    // Fetch brand + industry context to enrich AI prompts
    const [brand, industries] = await Promise.all([
      website.brandProfileId ? storage.getBrandProfile(website.brandProfileId) : Promise.resolve(undefined),
      storage.getIndustries(website.accountId),
    ]);
    const industry = industries[0];
    const ctx: BrandContext = {
      brandName: brand?.name,
      brandDescription: brand?.description ?? undefined,
      voiceAndTone: brand?.voiceAndTone ?? undefined,
      industryName: industry?.name,
      industryDescription: industry?.description ?? undefined,
    };

    await storage.deleteVariationBanks(websiteId, service);
    try {
      await writeVariationsForService(service, website.accountId, websiteId, ctx);
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode ?? 500;
      const msg = err?.error?.error?.message ?? err?.message ?? "Claude API error";
      return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
    }
    return res.json({ ok: true, context: { brand: ctx.brandName, industry: ctx.industryName } });
  });

  // Background write-all — persistent job that survives server restarts
  app.post("/api/websites/:id/variation-banks/write-all", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const [allServices, bankedNames, brand, industries] = await Promise.all([
      storage.getServices(website.accountId),
      storage.getVariationBankServices(websiteId),
      website.brandProfileId ? storage.getBrandProfile(website.brandProfileId) : Promise.resolve(undefined),
      storage.getIndustries(website.accountId),
    ]);

    const { force } = z.object({ force: z.boolean().optional() }).parse(req.body);
    const bankedSet = new Set(bankedNames);
    const toProcess = force ? allServices : allServices.filter(s => !bankedSet.has(s.name));
    if (toProcess.length === 0) return res.json({ started: false, total: 0, alreadyDone: true });

    const industry = industries[0];
    const ctx: BrandContext = {
      brandName: brand?.name,
      brandDescription: brand?.description ?? undefined,
      voiceAndTone: brand?.voiceAndTone ?? undefined,
      industryName: industry?.name,
      industryDescription: industry?.description ?? undefined,
    };

    const { startBankWriteJob } = await import("./services/bank-write-background");
    const jobId = await startBankWriteJob(
      websiteId,
      website.accountId,
      toProcess.map(s => ({ id: s.id, name: s.name })),
      ctx,
    );

    return res.json({ started: true, total: toProcess.length, jobId });
  });

  // Fix 4 — Write only thin/incomplete variation banks
  app.post("/api/websites/:id/variation-banks/write-thin", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const { threshold = 70 } = z.object({ threshold: z.number().optional() }).parse(req.body);
    const [thinWarnings, allServices, brand, industries] = await Promise.all([
      storage.getThinBankWarnings(websiteId, threshold),
      storage.getServices(website.accountId),
      website.brandProfileId ? storage.getBrandProfile(website.brandProfileId) : Promise.resolve(undefined),
      storage.getIndustries(website.accountId),
    ]);
    if (thinWarnings.length === 0) return res.json({ started: false, total: 0, message: "No thin banks found below threshold" });
    const thinServiceNames = new Set(thinWarnings.map((w: any) => w.service.toLowerCase()));
    const toProcess = allServices.filter(s => thinServiceNames.has(s.name.toLowerCase()));
    if (toProcess.length === 0) return res.json({ started: false, total: 0, message: "No matching services" });
    const industry = industries[0];
    const ctx: any = {
      brandName: brand?.name,
      brandDescription: (brand as any)?.description ?? undefined,
      voiceAndTone: (brand as any)?.voiceAndTone ?? undefined,
      industryName: industry?.name,
      industryDescription: (industry as any)?.description ?? undefined,
    };
    const { startBankWriteJob } = await import("./services/bank-write-background");
    const jobId = await startBankWriteJob(websiteId, website.accountId, toProcess.map(s => ({ id: s.id, name: s.name })), ctx);
    return res.json({ started: true, total: toProcess.length, jobId, thinCount: thinWarnings.length });
  });

  // Fill-missing-all: start a background job that fills only missing sections (no rewrites)
  app.post("/api/websites/:id/variation-banks/fill-missing-all-job", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const { services: serviceNames } = z.object({ services: z.array(z.string()).min(1) }).parse(req.body);
    const [allServices, brand, industries] = await Promise.all([
      storage.getServices(website.accountId),
      website.brandProfileId ? storage.getBrandProfile(website.brandProfileId) : Promise.resolve(undefined),
      storage.getIndustries(website.accountId),
    ]);
    const nameSet = new Set(serviceNames.map(n => n.toLowerCase()));
    const toProcess = allServices.filter(s => nameSet.has(s.name.toLowerCase()));
    if (toProcess.length === 0) return res.json({ started: false, total: 0, message: "No matching services found" });

    const industry = industries[0];
    const ctx: BrandContext = {
      brandName: brand?.name,
      brandDescription: brand?.description ?? undefined,
      voiceAndTone: brand?.voiceAndTone ?? undefined,
      industryName: industry?.name,
      industryDescription: industry?.description ?? undefined,
    };
    const { startBankWriteJob } = await import("./services/bank-write-background");
    const jobId = await startBankWriteJob(
      websiteId, website.accountId,
      toProcess.map(s => ({ id: s.id, name: s.name })),
      ctx,
      "fill_missing",
    );
    return res.json({ started: true, total: toProcess.length, jobId });
  });

  // Active fill-missing job status for a website (used by UI to restore progress bar on page refresh)
  // Covers both fill_missing and write_all modes so any active bank-write job is restored.
  app.get("/api/websites/:id/fill-missing-job", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const jobs = await storage.getGenerationJobs(websiteId);
    const active = jobs.find(j => {
      const s = j.settings as any;
      return s?.type === "bank_write" && (s?.mode === "fill_missing" || s?.mode === "write_all") && (j.status === "running" || j.status === "pending");
    });
    if (!active) return res.json(null);
    return res.json({ jobId: active.id, processedPages: active.processedPages, totalPages: active.totalPages, status: active.status });
  });

  // Active bank-write job status for a website (used by UI to restore progress bar on page refresh)
  app.get("/api/websites/:id/bank-write-job", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const jobs = await storage.getGenerationJobs(websiteId);
    const active = jobs.find(j => {
      const s = j.settings as any;
      return s?.type === "bank_write" && s?.mode === "write_all" && (j.status === "running" || j.status === "pending");
    });
    if (!active) return res.json(null);
    const s = active.settings as any;
    const total: number = s.progress?.length ?? active.totalPages;
    const done: number = s.progress?.filter((p: any) => p.status === "done" || p.status === "error").length ?? active.processedPages;
    return res.json({ jobId: active.id, total, done, status: active.status });
  });

  app.post("/api/websites/:id/bulk-generate", requireAuth, async (req: Request, res: Response) => {
    const schema = z.object({
      service: z.string().min(1),
      mode: z.enum(["all_states", "specific_states", "specific_cities"]),
      states: z.array(z.string()).optional(),
      cities: z.array(z.object({ name: z.string(), stateAbbr: z.string() })).optional(),
      blueprintId: z.string().uuid().optional(),
      overwrite: z.boolean().optional(),
    });
    const body = schema.parse(req.body);
    const websiteId = req.params.id as string;

    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    if (website.accountId) {
      const acct = await storage.getAccount(website.accountId);
      if (acct?.clientStatus === "paused") {
        return res.status(403).json({ error: "This client is paused. Resume to run generation." });
      }
      if (acct?.clientStatus === "archived") {
        return res.status(403).json({ error: "This client is archived. Generation is blocked." });
      }
    }

    const brand = await storage.getBrandProfile(website.brandProfileId as string);
    const brandName = brand?.name ?? website.domain;

    const banks = await storage.getVariationBanks(websiteId, body.service);
    if (banks.length === 0) return res.status(400).json({ error: "No variation banks found for this service. Please write variations first." });

    const serviceSlug = body.service.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    // Fetch blueprint templates — use request value, else fall back to website's default blueprint
    const effectiveBlueprintId = body.blueprintId || (website.settings as any)?.defaultBlueprintId || null;
    const blueprint = effectiveBlueprintId ? await storage.getBlueprint(effectiveBlueprintId) : null;
    function applyBlueprintTemplates(vars: { service: string; location: string; state: string; stateAbbr: string; brand: string }) {
      if (!blueprint) return null;
      // Handle {service}, {service-lowercase-hyphenate}, {service_slug} and all other modifier forms
      // by matching anything that starts with the variable name inside {}
      const slugifyStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const interp = (t: string) => t
        .replace(/\{service[^}]*\}/gi, vars.service)
        .replace(/\{location[^}]*\}/gi, vars.location)
        .replace(/\{city[^}]*\}/gi, vars.location)
        // abbr/state_abbr must come before generic {state…} catch-all
        .replace(/\{state[-_]abbr[^}]*\}/gi, vars.stateAbbr)
        .replace(/\{abbr[^}]*\}/gi, vars.stateAbbr)
        // {state-slug}, {state_slug}, {state|slugify} → slugified state name
        .replace(/\{state[-_]slug[^}]*\}/gi, slugifyStr(vars.state))
        .replace(/\{state\|[^}]*\}/gi, slugifyStr(vars.state))
        // bare {state} → raw state name
        .replace(/\{state\}/gi, vars.state)
        .replace(/\{brand[^}]*\}/gi, vars.brand)
        .replace(/\{keyword[^}]*\}/gi, vars.service)
        .replace(/-{2,}/g, "-").trim();
      const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return {
        title: interp(blueprint.titleTemplate),
        h1: interp(blueprint.h1Template),
        metaDescription: interp(blueprint.metaDescTemplate),
        slug: slugify(interp(blueprint.slugTemplate)),
      };
    }

    const allStateAbbrs = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

    const targets: Array<{ locationName: string; locationType: string; stateAbbr: string; stateName: string }> = [];

    if (body.mode === "all_states") {
      for (const abbr of allStateAbbrs) {
        const sd = await storage.getStateDataByAbbr(abbr);
        if (sd) targets.push({ locationName: sd.stateName, locationType: "state", stateAbbr: abbr, stateName: sd.stateName });
      }
    } else if (body.mode === "specific_states" && body.states) {
      for (const abbr of body.states) {
        const sd = await storage.getStateDataByAbbr(abbr);
        if (sd) targets.push({ locationName: sd.stateName, locationType: "state", stateAbbr: abbr, stateName: sd.stateName });
      }
    } else if (body.mode === "specific_cities" && body.cities) {
      for (const c of body.cities) {
        const sd = await storage.getStateDataByAbbr(c.stateAbbr);
        targets.push({ locationName: c.name, locationType: "city", stateAbbr: c.stateAbbr, stateName: sd?.stateName ?? c.stateAbbr });
      }
    }

    const results = { created: 0, updated: 0, skipped: 0, errors: 0, slugs: [] as string[] };

    for (const t of targets) {
      try {
        const sd = await storage.getStateDataByAbbr(t.stateAbbr);
        const result = buildVariationPage(body.service, serviceSlug, t.locationName, t.locationType, t.stateName, t.stateAbbr, brandName, banks, sd);

        // Apply blueprint templates if selected — they override title/H1/meta/slug
        const bpOverride = applyBlueprintTemplates({
          service: body.service,
          location: t.locationName,
          state: t.stateName,
          stateAbbr: t.stateAbbr,
          brand: brandName,
        });
        const finalSlug = bpOverride?.slug || result.slug;
        const finalTitle = bpOverride?.title || result.title;
        const finalH1 = bpOverride?.h1 || result.h1;
        const finalMeta = bpOverride?.metaDescription || result.metaDescription;

        const existingPage = await storage.getPageBySlug(websiteId, finalSlug);
        if (existingPage) {
          if (!body.overwrite) {
            results.skipped++;
            continue;
          }
          // Overwrite mode — update metadata and replace active page version
          await storage.updatePage(existingPage.id, {
            title: finalTitle,
            h1: finalH1,
            metaDescription: finalMeta,
            wordCount: result.wordCount,
            blueprintId: body.blueprintId || null,
          });
          const existingVersions = await storage.getPageVersions(existingPage.id);
          const nextVersion = (existingVersions.length > 0 ? Math.max(...existingVersions.map((v: any) => v.version)) : 0) + 1;
          const pv = await storage.createPageVersion({
            pageId: existingPage.id,
            version: nextVersion,
            contentHtml: result.contentHtml,
            isActive: true,
          });
          await storage.setActivePageVersion(existingPage.id, pv.id);
          results.updated++;
          results.slugs.push(finalSlug);
          continue;
        }

        const page = await storage.createPage({
          websiteId,
          blueprintId: body.blueprintId || null,
          serviceId: null,
          locationId: null,
          queryClusterId: null,
          slug: finalSlug,
          title: finalTitle,
          h1: finalH1,
          metaDescription: finalMeta,
          status: "published",
          pageType: t.locationType === "state" ? "state_hub" : "service_city",
          wordCount: result.wordCount,
        });

        const pv = await storage.createPageVersion({
          pageId: page.id,
          version: 1,
          contentHtml: result.contentHtml,
          isActive: true,
        });
        await storage.setActivePageVersion(page.id, pv.id);

        results.created++;
        results.slugs.push(finalSlug);
      } catch (err) {
        results.errors++;
        console.error("[bulk-generate] error for", t.locationName, err);
      }
    }

    // Detect broken blueprint templates: if all generated slugs are identical,
    // the template variables weren't substituted properly
    const uniqueSlugs = new Set(results.slugs);
    if (results.slugs.length > 1 && uniqueSlugs.size === 1) {
      console.warn("[bulk-generate] WARNING: all slugs resolved to the same value:", [...uniqueSlugs][0], "— blueprint slug template may contain unsupported variable names");
      (results as any).warning = `All pages resolved to slug "${[...uniqueSlugs][0]}" — check your blueprint slug template uses supported variables like {service}, {location}, {state}`;
    }

    // Sync the website's cached publishedPages counter with the live count
    if (results.created > 0 || results.updated > 0) {
      await storage.syncWebsitePublishedCount(websiteId);
    }

    return res.json(results);
  });

  // ── Background Bulk Generate — returns jobId immediately, runs server-side ──
  app.post("/api/websites/:id/bulk-generate-job", requireAuth, async (req: Request, res: Response) => {
    const schema = z.object({
      services: z.array(z.string().min(1)).min(1),
      mode: z.enum(["all_states", "specific_states", "specific_cities"]),
      states: z.array(z.string()).optional(),
      cities: z.array(z.object({ name: z.string(), stateAbbr: z.string() })).optional(),
      blueprintId: z.string().uuid().optional(),
      queryClusterIds: z.array(z.string().uuid()).optional(),
      overwrite: z.boolean().optional(),
    });
    const body = schema.parse(req.body);
    const websiteId = req.params.id as string;

    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    if (website.accountId) {
      const acct = await storage.getAccount(website.accountId);
      if (acct?.clientStatus === "paused") {
        return res.status(403).json({ error: "This client is paused. Resume to run generation." });
      }
      if (acct?.clientStatus === "archived") {
        return res.status(403).json({ error: "This client is archived. Generation is blocked." });
      }
    }

    const progress = body.services.map(s => ({ service: s, status: "pending" as const, created: 0, updated: 0, skipped: 0, errors: 0 }));
    // Resolve effective cluster count so the job card can display it accurately
    let effectiveClusterCount = 1;
    if (website.accountId) {
      const allClusters = await storage.getQueryClusters(website.accountId);
      effectiveClusterCount = (body.queryClusterIds && body.queryClusterIds.length > 0)
        ? body.queryClusterIds.length
        : (allClusters.length > 0 ? allClusters.length : 1);
    }

    const jobSettings = { ...body, progress, clusterCount: effectiveClusterCount };

    const job = await storage.createGenerationJob({
      accountId: website.accountId!,
      websiteId,
      blueprintId: body.blueprintId || null,
      name: `Bulk Generate — ${body.services.length} service(s)`,
      status: "pending",
      totalPages: 0,
      processedPages: 0,
      passedPages: 0,
      failedPages: 0,
      errorLog: [],
      settings: jobSettings as any,
    });

    // Fire-and-forget — runs entirely on the server after response is sent
    const { runBulkBackgroundJob } = await import("./services/bulk-background");
    setImmediate(() => {
      runBulkBackgroundJob(job.id).catch(err => {
        console.error("[bulk-background] unhandled error in job", job.id, err);
        storage.updateGenerationJob(job.id, { status: "failed", completedAt: new Date() }).catch(() => {});
      });
    });

    return res.json({ jobId: job.id, message: "Job started in background" });
  });

  // ── Content Find-and-Replace (admin) ─────────────────────────────────────
  app.post("/api/websites/:id/content-replace", requireAuth, async (req: Request, res: Response) => {
    const schema = z.object({
      find: z.string().min(1),
      replace: z.string(),
    });
    const { find, replace } = schema.parse(req.body);
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const updated = await storage.replacePageContent(websiteId, find, replace);
    return res.json({ updated });
  });

  // ── Contact Form (public) ─────────────────────────────────────────────────

  // Simple in-memory rate limiter: max 5 submissions per IP per 10 minutes
  const contactRateMap = new Map<string, number[]>();
  const CONTACT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  const CONTACT_MAX_REQS = 5;

  app.post("/api/public/contact", async (req: Request, res: Response) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const timestamps = (contactRateMap.get(ip) || []).filter(t => now - t < CONTACT_WINDOW_MS);
    if (timestamps.length >= CONTACT_MAX_REQS) {
      return res.status(429).json({ success: false, message: "Too many submissions. Please try again later." });
    }
    timestamps.push(now);
    contactRateMap.set(ip, timestamps);
    try {
      const schema = z.object({
        websiteId: z.string().uuid(),
        pageId: z.string().uuid().optional(),
        pageSlug: z.string().optional(),
        name: z.string().min(1).max(200),
        businessName: z.string().max(200).optional(),
        email: z.string().email(),
        phone: z.string().max(50).optional(),
        message: z.string().max(2000).optional(),
      });
      const data = schema.parse(req.body);

      const website = await storage.getWebsite(data.websiteId);
      if (!website) return res.status(404).json({ success: false, message: "Unknown website" });

      const existing = await storage.findRecentLeadByEmail(data.websiteId, data.email);
      if (existing) {
        return res.json({ success: true, id: existing.id, duplicate: true });
      }

      const lead = await storage.createLead({
        websiteId: data.websiteId,
        pageId: data.pageId || null,
        pageSlug: data.pageSlug || null,
        name: data.name,
        businessName: data.businessName || null,
        email: data.email,
        phone: data.phone || null,
        message: data.message || null,
      });

      const contactEmail = (website.settings as any)?.contactEmail;
      if (contactEmail && process.env.SMTP_HOST) {
        try {
          const nodemailer = await import("nodemailer");
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || "587"),
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          });
          await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: contactEmail,
            subject: `New lead from ${website.name}: ${data.name}`,
            text: [
              `Name: ${data.name}`,
              `Business: ${data.businessName || "—"}`,
              `Email: ${data.email}`,
              `Phone: ${data.phone || "—"}`,
              `Page: ${data.pageSlug || "—"}`,
              `Message: ${data.message || "—"}`,
            ].join("\n"),
          });
        } catch (mailErr) {
          console.error("[contact] email send failed:", mailErr);
        }
      }

      return res.json({ success: true, id: lead.id });
    } catch (err: any) {
      if (err?.name === "ZodError") {
        return res.status(400).json({ success: false, message: "Please fill in all required fields correctly." });
      }
      console.error("[contact] error:", err);
      return res.status(500).json({ success: false, message: "Server error. Please try again." });
    }
  });

  // ── SEO Control: Tier & Quality Score APIs ────────────────────────────────

  app.get("/api/websites/:id/tier-stats", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const [tierDist, scoreDist] = await Promise.all([
      storage.getTierDistribution(websiteId),
      storage.getScoreDistribution(websiteId),
    ]);
    return res.json({ ...tierDist, scoreDistribution: scoreDist });
  });

  // Background scoring job — scores all unscored pages for a website
  app.post("/api/websites/:id/score-pages", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    // Return immediately — scoring runs in background
    res.json({ ok: true, message: "Scoring job started" });

    setImmediate(async () => {
      const { scorePageContent } = await import("./services/scoring");
      let processed = 0;
      const BATCH = 500;
      const blueprint = (website.settings as any)?.defaultBlueprintId
        ? await storage.getBlueprint((website.settings as any).defaultBlueprintId)
        : null;
      const minScoreForTier1 = (blueprint as any)?.minScoreForTier1 ?? 80;

      while (true) {
        const unscored = await storage.getUnscoredPages(websiteId, BATCH);
        if (unscored.length === 0) break;
        for (const p of unscored) {
          try {
            const version = await storage.getActivePageVersion(p.id);
            const banks = await storage.getVariationBanks(websiteId, p.title.split(" in ")[0] || "");
            const scoreResult = scorePageContent(
              version?.contentHtml || "",
              p.metaDescription || "",
              p.title,
              p.wordCount || 0,
              banks,
              minScoreForTier1,
            );
            await storage.updatePageScore(p.id, scoreResult.total, scoreResult as any, scoreResult.recommendedTier);
            processed++;
          } catch { /* skip individual failures */ }
        }
        if (unscored.length < BATCH) break;
      }
      console.log(`[score-pages] Done: scored ${processed} pages for website ${websiteId}`);
    });
  });

  // Bulk apply tier assignments based on scores
  app.post("/api/websites/:id/apply-tiers", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const { tier1Threshold = 80, tier3Threshold = 50, applyTier3 = false } = req.body;
    const { promoted } = await storage.bulkUpdatePageTiers(websiteId, tier1Threshold);
    let demoted = 0;
    if (applyTier3) {
      const result = await storage.bulkSetTier3(websiteId, tier3Threshold);
      demoted = result.demoted;
    }
    return res.json({ ok: true, promoted, demoted });
  });

  // Set a single page's tier
  app.patch("/api/pages/:id/tier", requireAuth, async (req: Request, res: Response) => {
    const { tier } = z.object({ tier: z.number().int().min(1).max(3) }).parse(req.body);
    await storage.updatePageTier(req.params.id as string, tier);
    return res.json({ ok: true });
  });

  // Fix 5 — Preview how many pages match bulk-tier filters
  app.get("/api/websites/:id/pages/bulk-tier-preview", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const q = req.query as Record<string, string>;
    const filters: any = {};
    if (q.serviceId) filters.serviceId = q.serviceId;
    if (q.locationId) filters.locationId = q.locationId;
    if (q.locationName) filters.locationName = q.locationName;
    if (q.blueprintId) filters.blueprintId = q.blueprintId;
    if (q.scoreMin) filters.scoreMin = Number(q.scoreMin);
    if (q.scoreMax) filters.scoreMax = Number(q.scoreMax);
    const result = await storage.bulkFilterPagesCount(websiteId, filters);
    return res.json(result);
  });

  // AI Suggest — recommend tier + score range from filter context
  app.post("/api/websites/:id/pages/bulk-tier-suggest", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: "ANTHROPIC_API_KEY not configured" });
    const { serviceName, locationName, blueprintName, currentTier, scoreMin, scoreMax } = req.body as Record<string, string | undefined>;
    const prompt = `You are an SEO tier-assignment assistant for a white-pages publishing platform called Nexus.

TIER SYSTEM:
- Tier 1 (Top Priority): Pages with highest quality scores, included in the primary sitemap, given priority crawl budget. Typically quality score >= 75.
- Tier 2 (Live): Standard published pages, in secondary sitemap. Typically quality score 45–74.
- Tier 3 (noindex): Low-quality or thin pages, excluded from sitemaps. Typically quality score < 45.

CURRENT FILTER CONTEXT:
${serviceName ? `- Service: ${serviceName}` : "- Service: (any)"}
${locationName ? `- Location filter: ${locationName}` : "- Location: (any)"}
${blueprintName ? `- Blueprint: ${blueprintName}` : "- Blueprint: (any)"}
${currentTier ? `- Current tier target: ${currentTier}` : "- Tier target: (not set)"}
${scoreMin ? `- Min score filter: ${scoreMin}` : "- Min score: (not set)"}
${scoreMax ? `- Max score filter: ${scoreMax}` : "- Max score: (not set)"}

Based on this context, recommend the best tier and score range to assign.
Return ONLY valid JSON (no markdown, no explanation outside the JSON):
{
  "tier": <1, 2, or 3>,
  "minScore": <integer 0-100 or null>,
  "maxScore": <integer 0-100 or null>,
  "reason": "<one sentence explaining the recommendation>"
}`;

    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await ai.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: "Could not parse AI response" });
      const result = JSON.parse(jsonMatch[0]);
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "AI request failed" });
    }
  });

  // Fix 5 — Bulk set tier on filtered pages
  app.post("/api/websites/:id/pages/bulk-set-tier", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const { tier, filters } = z.object({
      tier: z.number().int().min(1).max(3),
      filters: z.object({
        serviceId: z.string().optional(),
        locationId: z.string().optional(),
        locationName: z.string().optional(),
        blueprintId: z.string().optional(),
        scoreMin: z.number().optional(),
        scoreMax: z.number().optional(),
      }).optional().default({}),
    }).parse(req.body);
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const result = await storage.bulkSetPageTier(websiteId, tier, filters);
    if (result.affected > 0) {
      const { scheduleSitemapRegen } = await import("./services/automation");
      scheduleSitemapRegen(websiteId);
    }
    return res.json({ ok: true, affected: result.affected });
  });

  // Fix 6 — Submit all Tier 1 published pages to Google Indexing API
  app.post("/api/websites/:id/pages/submit-tier1-to-google", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const tier1Pages = await storage.getPagesByTier(websiteId, 1, 1000, 0);
    if (tier1Pages.length === 0) return res.json({ submitted: 0, urls: [] });
    const pDom = (website.settings as any)?.parentDomain;
    const pPth = (website.settings as any)?.proxyPath || "";
    const base = pDom ? `https://${pDom}${pPth}` : `https://${website.domain}`;
    const urls = tier1Pages.map(p => `${base}/${p.slug}`);
    const { submitUrlsToGoogle } = await import("./services/gsc-indexing");
    const CHUNK = 200;
    let submitted = 0;
    const errors: string[] = [];
    for (let i = 0; i < urls.length; i += CHUNK) {
      try {
        await submitUrlsToGoogle(urls.slice(i, i + CHUNK));
        submitted += Math.min(CHUNK, urls.length - i);
      } catch (e: any) { errors.push(e.message); }
    }
    return res.json({ submitted, total: tier1Pages.length, errors: errors.length > 0 ? errors : undefined, urls: urls.slice(0, 20) });
  });

  // ── SEO Control: Fallback Hits ─────────────────────────────────────────────

  app.get("/api/websites/:id/fallback-hits", requireAuth, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || "50"), 200);
    return res.json(await storage.getFallbackHits(req.params.id as string, limit));
  });

  app.post("/api/websites/:id/fallback-hits/promote", requireAuth, async (req: Request, res: Response) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(req.body);
    await storage.promoteFallbackSlug(req.params.id as string, slug);
    return res.json({ ok: true });
  });

  // ── SEO Control: Bank Completeness ────────────────────────────────────────

  app.get("/api/websites/:id/bank-completeness", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getBankCompleteness(req.params.id as string));
  });

  // Recompute completeness for all services of a website
  app.post("/api/websites/:id/bank-completeness/recompute", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const { computeBankCompleteness } = await import("./services/scoring");
    const services = await storage.getVariationBankServices(websiteId);
    let computed = 0;
    for (const svc of services) {
      const banks = await storage.getVariationBanks(websiteId, svc);
      const result = computeBankCompleteness(banks);
      await storage.upsertBankCompleteness({
        websiteId, service: svc,
        hasIntro: result.hasIntro, hasHowItWorks: result.hasHowItWorks, hasBenefits: result.hasBenefits,
        hasFaq: result.hasFaq, hasCta: result.hasCta,
        hasLocalContext: result.hasLocalContext, hasUseCase: result.hasUseCase,
        hasProofTrust: result.hasProofTrust, hasPainPoint: result.hasPainPoint,
        hasLocalStat: result.hasLocalStat,
        totalVariations: result.totalVariations,
        avgVariationsPerSection: result.avgVariationsPerSection, completenessScore: result.completenessScore,
        isEligibleForTier1: result.isEligibleForTier1,
      } as any);
      computed++;
    }
    return res.json({ ok: true, computed });
  });

  // Fill only missing sections for a single service (does not touch existing sections)
  app.post("/api/websites/:id/variation-banks/fill-missing", requireAuth, async (req: Request, res: Response) => {
    const { service } = z.object({ service: z.string().min(1) }).parse(req.body);
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const [brand, industries] = await Promise.all([
      website.brandProfileId ? storage.getBrandProfile(website.brandProfileId) : Promise.resolve(undefined),
      storage.getIndustries(website.accountId),
    ]);
    const industry = industries[0];
    const ctx: BrandContext = {
      brandName: brand?.name,
      brandDescription: brand?.description ?? undefined,
      voiceAndTone: brand?.voiceAndTone ?? undefined,
      industryName: industry?.name,
      industryDescription: industry?.description ?? undefined,
    };

    try {
      const result = await fillMissingSectionsForService(service, website.accountId, websiteId, ctx);
      // Recompute completeness after filling
      const { computeBankCompleteness } = await import("./services/scoring");
      const banks = await storage.getVariationBanks(websiteId, service);
      const completeness = computeBankCompleteness(banks);
      await storage.upsertBankCompleteness({
        websiteId, service,
        hasIntro: completeness.hasIntro, hasHowItWorks: completeness.hasHowItWorks,
        hasBenefits: completeness.hasBenefits, hasFaq: completeness.hasFaq, hasCta: completeness.hasCta,
        hasLocalContext: completeness.hasLocalContext, hasUseCase: completeness.hasUseCase,
        hasProofTrust: completeness.hasProofTrust, hasPainPoint: completeness.hasPainPoint,
        hasLocalStat: completeness.hasLocalStat,
        totalVariations: completeness.totalVariations,
        avgVariationsPerSection: completeness.avgVariationsPerSection,
        completenessScore: completeness.completenessScore,
        isEligibleForTier1: completeness.isEligibleForTier1,
      } as any);
      return res.json({ ok: true, ...result, completenessScore: completeness.completenessScore });
    } catch (err: any) {
      const status = err?.status ?? 500;
      return res.status(status >= 400 && status < 600 ? status : 500).json({ error: err?.message ?? "Failed" });
    }
  });

  // ── Hub Pages (Phase 5) ────────────────────────────────────────────────────

  app.get("/api/websites/:id/hub-pages", requireAuth, async (req: Request, res: Response) => {
    const hubs = await storage.getHubPages(req.params.id as string);
    return res.json(hubs);
  });

  app.post("/api/websites/:id/hub-pages", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const { hubType, name, slug, parentSlug, maxChildLinks, metaDescription } = req.body as any;
    if (!hubType || !name || !slug) return res.status(400).json({ error: "hubType, name, and slug are required" });
    const hub = await storage.createHubPage({
      websiteId,
      accountId: website.accountId,
      hubType,
      name,
      slug,
      parentSlug: parentSlug || null,
      maxChildLinks: maxChildLinks ?? 30,
      metaDescription: metaDescription || null,
      status: "draft",
      tier: 1,
    });
    return res.status(201).json(hub);
  });

  // Bulk-publish all draft hub pages (optionally scoped to a hubType)
  app.post("/api/websites/:id/hub-pages/bulk-publish", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const { hubType } = req.body as any;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const allHubs = await storage.getHubPages(websiteId);
    const drafts = allHubs.filter((h: any) => h.status === "draft" && (!hubType || h.hubType === hubType));
    const total = drafts.length;
    if (total === 0) return res.json({ published: 0, jobId: null });
    const label = hubType
      ? `Publish ${hubType.charAt(0).toUpperCase() + hubType.slice(1)} Hub Drafts`
      : "Publish All Hub Drafts";
    const job = await storage.createGenerationJob({
      websiteId,
      accountId: website.accountId,
      name: label,
      status: "running" as any,
      totalPages: total,
      processedPages: 0,
      passedPages: 0,
      failedPages: 0,
      settings: { type: "hub_bulk_publish", hubType: hubType || "all" } as any,
      startedAt: new Date(),
    });
    const published = await storage.bulkPublishHubDrafts(websiteId, hubType);
    await storage.updateGenerationJob(job.id, {
      status: "completed" as any,
      processedPages: published,
      passedPages: published,
      completedAt: new Date(),
    });
    return res.json({ published, jobId: job.id });
  });

  app.patch("/api/websites/:id/hub-pages/:hubId", requireAuth, async (req: Request, res: Response) => {
    const { hubId } = req.params as any;
    const { name, slug, parentSlug, maxChildLinks, metaDescription, status, tier } = req.body as any;
    const hub = await storage.updateHubPage(hubId, {
      ...(name !== undefined && { name }),
      ...(slug !== undefined && { slug }),
      ...(parentSlug !== undefined && { parentSlug }),
      ...(maxChildLinks !== undefined && { maxChildLinks }),
      ...(metaDescription !== undefined && { metaDescription }),
      ...(status !== undefined && { status }),
      ...(tier !== undefined && { tier }),
    });
    if (!hub) return res.status(404).json({ error: "Hub page not found" });
    return res.json(hub);
  });

  app.delete("/api/websites/:id/hub-pages/:hubId", requireAuth, async (req: Request, res: Response) => {
    await storage.deleteHubPage(req.params.hubId as string);
    return res.json({ ok: true });
  });

  // Preview child links that would be included in a hub
  app.get("/api/websites/:id/hub-pages/:hubId/child-links", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const hub = await storage.getHubPage(req.params.hubId as string);
    if (!hub) return res.status(404).json({ error: "Hub page not found" });
    const childLinks = await storage.getChildPagesForHub(websiteId, hub.hubType, hub.name, hub.maxChildLinks);
    return res.json(childLinks);
  });

  // Generate (or re-generate) the HTML content for a hub page and set status to "published"
  app.post("/api/websites/:id/hub-pages/:hubId/generate", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const hub = await storage.getHubPage(req.params.hubId as string);
    if (!hub) return res.status(404).json({ error: "Hub page not found" });
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const brandProfiles = await storage.getBrandProfiles(website.accountId);
    const brand = brandProfiles[0];
    const childLinks = await storage.getChildPagesForHub(websiteId, hub.hubType, hub.name, hub.maxChildLinks);

    const { renderHubPageHtml } = await import("./services/hub-pages");
    const content = renderHubPageHtml({
      hubType: hub.hubType as any,
      name: hub.name,
      slug: hub.slug,
      metaDescription: hub.metaDescription,
      parentSlug: hub.parentSlug,
      childLinks,
      website: { domain: website.domain, settings: (website.settings ?? {}) as any },
      brand: brand ? {
        name: brand.name,
        primaryColor: brand.primaryColor ?? undefined,
        phone: brand.phone ?? undefined,
        tagline: brand.tagline ?? undefined,
        customFields: (brand.customFields ?? {}) as any,
      } : null,
    });

    const updated = await storage.updateHubPage(hub.id, { content, status: "published" });
    return res.json({ ok: true, hub: updated, childCount: childLinks.length });
  });

  // Fix 1 — Bulk hub page generation
  app.post("/api/websites/:id/hub-pages/bulk-generate", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const body = z.object({
      hubType: z.enum(["service", "state", "city"]),
      services: z.array(z.string()).optional().default([]),
      states: z.array(z.string()).optional().default([]),
      cities: z.array(z.string()).optional().default([]),
      maxChildLinks: z.number().int().min(1).max(200).optional().default(30),
      generateAI: z.boolean().optional().default(false),
    }).parse(req.body);
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const names = body.hubType === "service" ? body.services : body.hubType === "state" ? body.states : body.cities;
    if (names.length === 0) return res.status(400).json({ error: "No items selected" });
    const job = await storage.createGenerationJob({
      accountId: website.accountId,
      websiteId,
      name: `Bulk Hub Generate — ${body.hubType} (${names.length})`,
      status: "pending",
      totalPages: names.length,
      processedPages: 0,
      passedPages: 0,
      failedPages: 0,
      settings: { type: "hub_bulk", hubType: body.hubType, names, maxChildLinks: body.maxChildLinks, generateAI: body.generateAI, progress: names.map(n => ({ name: n, status: "pending" })) } as any,
    });
    setImmediate(async () => {
      try {
        const { renderHubPageHtml } = await import("./services/hub-pages");
        const brandProfiles = await storage.getBrandProfiles(website.accountId);
        const brand = brandProfiles[0];
        let s = (await storage.getGenerationJob(job.id))!.settings as any;
        await storage.updateGenerationJob(job.id, { status: "running", startedAt: new Date() });
        let passed = 0;
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          s.progress[i].status = "running";
          await storage.updateGenerationJob(job.id, { settings: s as any });
          try {
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            const existingHubs = await storage.getHubPages(websiteId);
            if (existingHubs.some((h: any) => h.slug === slug || (h.name.toLowerCase() === name.toLowerCase() && h.hubType === body.hubType))) {
              s.progress[i].status = "skipped";
              await storage.updateGenerationJob(job.id, { settings: s as any, processedPages: i + 1 });
              continue;
            }
            let metaDescription: string | null = null;
            if (body.generateAI && process.env.ANTHROPIC_API_KEY) {
              try {
                const Anthropic = (await import("@anthropic-ai/sdk")).default;
                const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
                const resp = await ai.messages.create({
                  model: "claude-haiku-4-5-20251001",
                  max_tokens: 200,
                  messages: [{ role: "user", content: `Write a compelling SEO meta description (max 155 chars) for a ${body.hubType} hub page about "${name}" for a business. Reply with ONLY the description text.` }],
                });
                const raw = resp.content[0].type === "text" ? resp.content[0].text.trim() : "";
                if (raw.length > 0) metaDescription = raw.slice(0, 155);
              } catch { /* non-fatal */ }
            }
            const hub = await storage.createHubPage({ websiteId, accountId: website.accountId, hubType: body.hubType, name, slug, parentSlug: null, maxChildLinks: body.maxChildLinks, metaDescription, status: "draft", tier: 1 });
            if (body.generateAI) {
              const childLinks = await storage.getChildPagesForHub(websiteId, body.hubType, name, body.maxChildLinks);
              const content = renderHubPageHtml({
                hubType: body.hubType as any,
                name,
                slug,
                metaDescription,
                parentSlug: null,
                childLinks,
                website: { domain: website.domain, settings: (website.settings ?? {}) as any },
                brand: brand ? { name: brand.name, primaryColor: (brand as any).primaryColor ?? undefined, phone: (brand as any).phone ?? undefined, tagline: (brand as any).tagline ?? undefined, customFields: ((brand as any).customFields ?? {}) as any } : null,
              });
              await storage.updateHubPage(hub.id, { content, status: "published" });
            }
            s.progress[i].status = "done";
            passed++;
          } catch (e: any) { s.progress[i].status = "error"; s.progress[i].error = e.message; }
          await storage.updateGenerationJob(job.id, { settings: s as any, processedPages: i + 1, passedPages: passed });
        }
        await storage.updateGenerationJob(job.id, { status: "completed", completedAt: new Date(), passedPages: passed });
      } catch (e: any) {
        await storage.updateGenerationJob(job.id, { status: "failed", completedAt: new Date() });
      }
    });
    return res.json({ jobId: job.id });
  });

  app.get("/api/websites/:id/hub-pages/bulk-job/:jobId", requireAuth, async (req: Request, res: Response) => {
    const job = await storage.getGenerationJob(req.params.jobId as string);
    if (!job) return res.status(404).json({ error: "Job not found" });
    const s = job.settings as any;
    const total = s.progress?.length ?? job.totalPages;
    const done = s.progress?.filter((p: any) => ["done", "error", "skipped"].includes(p.status)).length ?? job.processedPages;
    return res.json({ status: job.status, total, done, created: job.passedPages, progress: s.progress ?? [] });
  });

  // ── P8: Top Services / States by Tier 1 + Thin-Bank Warnings ─────────────

  app.get("/api/websites/:id/top-services", requireAuth, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || "10"), 50);
    return res.json(await storage.getTopServicesByTier1(req.params.id as string, limit));
  });

  app.get("/api/websites/:id/top-states", requireAuth, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || "10"), 50);
    return res.json(await storage.getTopStatesByTier1(req.params.id as string, limit));
  });

  app.get("/api/websites/:id/thin-bank-warnings", requireAuth, async (req: Request, res: Response) => {
    const threshold = Math.min(parseInt((req.query.threshold as string) || "60"), 100);
    return res.json(await storage.getThinBankWarnings(req.params.id as string, threshold));
  });

  // ── P6: Score & Promote in One Shot ───────────────────────────────────────

  app.post("/api/websites/:id/score-and-promote", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const { tier1Threshold = 80, tier3Threshold = 55, applyTier3 = false } = req.body;

    // Return immediately — runs in background
    res.json({ ok: true, message: "Score & Promote job started. Refresh stats in ~30s." });

    setImmediate(async () => {
      try {
        const { scorePageContent } = await import("./services/scoring");
        const blueprint = (website.settings as any)?.defaultBlueprintId
          ? await storage.getBlueprint((website.settings as any).defaultBlueprintId)
          : null;
        const minScoreForTier1 = (blueprint as any)?.minScoreForTier1 ?? 80;

        // 1. Score all unscored pages
        let scored = 0;
        while (true) {
          const unscored = await storage.getUnscoredPages(websiteId, 500);
          if (unscored.length === 0) break;
          for (const p of unscored) {
            try {
              const version = await storage.getActivePageVersion(p.id);
              const banks = await storage.getVariationBanks(websiteId, p.title.split(" in ")[0] || "");
              const scoreResult = scorePageContent(
                version?.contentHtml || "", p.metaDescription || "", p.title, p.wordCount || 0, banks, minScoreForTier1,
              );
              await storage.updatePageScore(p.id, scoreResult.total, scoreResult as any, scoreResult.recommendedTier);
              scored++;
            } catch { /* skip */ }
          }
          if (unscored.length < 500) break;
        }

        // 2. Apply tier assignments
        const { promoted, promotedSlugs } = await storage.bulkUpdatePageTiers(websiteId, tier1Threshold);
        let demoted = 0;
        if (applyTier3) {
          const r = await storage.bulkSetTier3(websiteId, tier3Threshold);
          demoted = r.demoted;
        }

        console.log(`[score-and-promote] Done — scored:${scored} promoted:${promoted} demoted:${demoted}`);

        // Auto 3: Debounced sitemap regen after tier changes
        if (promoted > 0 || demoted > 0) {
          try {
            const { scheduleSitemapRegen, getAutomationSettings } = await import("./services/automation");
            const autoSettings = getAutomationSettings(website);
            const pDomain = (website.settings as any)?.parentDomain;
            const pPathRaw4 = ((website.settings as any)?.proxyPath || "") as string;
            const pPath = pPathRaw4.startsWith("/sites/") ? "" : pPathRaw4;
            const canonBase = pDomain ? `https://${pDomain}${pPath}` : undefined;
            scheduleSitemapRegen(websiteId, website.domain, canonBase, autoSettings.sitemapRegenDebounceMinutes * 60 * 1000);
          } catch { /* non-critical */ }
        }

        // Auto 4: Submit newly promoted Tier 1 URLs to Google Indexing API
        if (promotedSlugs.length > 0) {
          try {
            const { submitTier1UrlsToGoogle, getAutomationSettings } = await import("./services/automation");
            const autoSettings = getAutomationSettings(website);
            if (autoSettings.googleIndexingEnabled) {
              submitTier1UrlsToGoogle(websiteId, promotedSlugs, website).catch(() => {});
            }
          } catch { /* non-critical */ }
        }
      } catch (e) {
        console.error("[score-and-promote] error:", e);
      }
    });
  });

  // ── P9: Per-page scoring ───────────────────────────────────────────────────

  app.post("/api/pages/:id/score", requireAuth, async (req: Request, res: Response) => {
    const page = await storage.getPage(req.params.id as string);
    if (!page) return res.status(404).json({ error: "Page not found" });
    const version = await storage.getActivePageVersion(page.id);
    const website = await storage.getWebsite(page.websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const blueprint = (website.settings as any)?.defaultBlueprintId
      ? await storage.getBlueprint((website.settings as any).defaultBlueprintId)
      : null;
    const minScoreForTier1 = (blueprint as any)?.minScoreForTier1 ?? 80;
    const { scorePageContent } = await import("./services/scoring");
    const banks = await storage.getVariationBanks(page.websiteId, page.title.split(" in ")[0] || "");
    const result = scorePageContent(
      version?.contentHtml || "", page.metaDescription || "", page.title, page.wordCount || 0, banks, minScoreForTier1,
    );
    await storage.updatePageScore(page.id, result.total, result as any, result.recommendedTier);
    return res.json({ ok: true, score: result.total, tier: result.recommendedTier, breakdown: result });
  });

  app.get("/api/websites/:id/recently-scored", requireAuth, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || "50"), 200);
    return res.json(await storage.getRecentlyScoredPages(req.params.id as string, limit));
  });

  // Unauthenticated webhook — score a single page by slug
  // Requires X-Nexus-Key header matching NEXUS_WEBHOOK_KEY env var
  app.post("/api/webhooks/score-page", async (req: Request, res: Response) => {
    const key = req.headers["x-nexus-key"];
    const expected = process.env.NEXUS_WEBHOOK_KEY;
    if (expected && key !== expected) return res.status(401).json({ error: "Unauthorized" });

    const { slug, websiteId } = req.body;
    if (!slug || !websiteId) return res.status(400).json({ error: "slug and websiteId required" });

    const page = await storage.getPageBySlug(websiteId, slug);
    if (!page) return res.status(404).json({ error: "Page not found" });

    const version = await storage.getActivePageVersion(page.id);
    const website = await storage.getWebsite(page.websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const { scorePageContent } = await import("./services/scoring");
    const banks = await storage.getVariationBanks(page.websiteId, page.title.split(" in ")[0] || "");
    const result = scorePageContent(
      version?.contentHtml || "", page.metaDescription || "", page.title, page.wordCount || 0, banks, 80,
    );
    await storage.updatePageScore(page.id, result.total, result as any, result.recommendedTier);
    return res.json({ ok: true, slug, score: result.total, tier: result.recommendedTier });
  });

  // ── P7: Internal Links ─────────────────────────────────────────────────────

  app.get("/api/websites/:id/internal-links/stats", requireAuth, async (req: Request, res: Response) => {
    return res.json(await storage.getInternalLinkStats(req.params.id as string));
  });

  app.post("/api/websites/:id/internal-links/rebuild", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    res.json({ ok: true, message: "Internal link rebuild started. Refresh stats in ~20s." });

    setImmediate(async () => {
      try {
        const { buildInternalLinks } = await import("./services/internal-links");
        const allPages = await storage.getPagesForLinking(websiteId, 100000);
        const links = buildInternalLinks(websiteId, allPages as any);
        await storage.clearInternalLinks(websiteId);
        const saved = await storage.saveInternalLinks(links);
        console.log(`[internal-links] Rebuilt: ${saved} links for website ${websiteId}`);
      } catch (e) {
        console.error("[internal-links] rebuild error:", e);
      }
    });
  });

  app.post("/api/internal-links/rebuild-all", requireAuth, async (req: Request, res: Response) => {
    const websites = await storage.getWebsites();
    res.json({ ok: true, count: websites.length, message: `Internal link rebuild started for ${websites.length} website(s).` });

    setImmediate(async () => {
      const { buildInternalLinks } = await import("./services/internal-links");
      for (const website of websites) {
        try {
          const allPages = await storage.getPagesForLinking(website.id, 100000);
          const links = buildInternalLinks(website.id, allPages as any);
          await storage.clearInternalLinks(website.id);
          const saved = await storage.saveInternalLinks(links);
          console.log(`[internal-links] Rebuilt: ${saved} links for website ${website.id} (${website.domain})`);
        } catch (e) {
          console.error(`[internal-links] rebuild error for ${website.id}:`, e);
        }
      }
      console.log("[internal-links] Rebuild-all complete.");
    });
  });

  app.post("/api/websites/:id/internal-links/ai-strategy", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: "ANTHROPIC_API_KEY not configured" });
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    try {
      const stats = await storage.getInternalLinkStats(websiteId);
      const services = await storage.getServices(website.accountId);
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const r = await ai.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{
          role: "user",
          content: `You are an internal linking SEO strategist. Analyze this website's internal link health and recommend improvements.

Website: ${website.name || website.domain}
Total pages: ${(stats as any)?.totalPublished ?? "unknown"}
Pages with internal links: ${(stats as any)?.pagesWithLinks ?? "unknown"}
Total links: ${(stats as any)?.totalLinks ?? "unknown"}
Services: ${services.slice(0, 10).map((s: any) => s.name).join(", ")}

Return ONLY valid JSON (no markdown):
{
  "summary": "1 sentence assessment of current internal link health",
  "recommendations": [
    { "title": "Short title", "description": "What to do and why it helps SEO", "impact": "high" },
    { "title": "Short title", "description": "What to do and why it helps SEO", "impact": "medium" },
    { "title": "Short title", "description": "What to do and why it helps SEO", "impact": "low" }
  ]
}

impact must be "high", "medium", or "low".`,
        }],
      });
      const raw = (r.content[0] as any).text.trim();
      const json = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim());
      return res.json(json);
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "AI error" });
    }
  });

  // ── Leads Admin ───────────────────────────────────────────────────────────

  app.get("/api/websites/:id/leads", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const limit = Math.min(parseInt((req.query.limit as string) || "50"), 200);
    const offset = parseInt((req.query.offset as string) || "0");
    const [items, total] = await Promise.all([
      storage.getLeads(websiteId, limit, offset),
      storage.getLeadCount(websiteId),
    ]);
    return res.json({ leads: items, total });
  });

  app.get("/api/leads", requireAuth, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || "100"), 200);
    const offset = parseInt((req.query.offset as string) || "0");
    const items = await storage.getAllLeads(limit, offset);
    return res.json({ leads: items });
  });

  app.post("/api/leads/ai-qualify", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: "ANTHROPIC_API_KEY not configured" });
    const { name, email, businessName, phone, message, pageSlug } = req.body as {
      name?: string; email?: string; businessName?: string; phone?: string; message?: string; pageSlug?: string;
    };
    if (!name || !email) return res.status(400).json({ error: "name and email are required" });
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const r = await ai.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{
          role: "user",
          content: `You are a sales assistant for a local service business. Qualify this lead and draft a follow-up email reply.

Lead info:
Name: ${name}
Email: ${email}
Business: ${businessName || "N/A"}
Phone: ${phone || "N/A"}
Page they came from: ${pageSlug || "N/A"}
Message: ${message || "(no message)"}

Return ONLY valid JSON (no markdown):
{
  "score": 85,
  "label": "Hot",
  "reasoning": "1-2 sentences on why this lead is scored this way",
  "draftReply": "A professional 3-4 sentence email reply addressing their inquiry, ready to send"
}

score is 0-100. label must be one of: "Hot", "Warm", "Cold".`,
        }],
      });
      const raw = (r.content[0] as any).text.trim();
      const json = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim());
      return res.json(json);
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "AI error" });
    }
  });

  // ── One-time admin fix: rewrite Related Services links to match blueprint slug format ──
  app.post("/api/admin/fix-related-links/:websiteId", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const { websiteId } = req.params;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const stateMap: Record<string, string> = {
      al:"alabama",ak:"alaska",az:"arizona",ar:"arkansas",ca:"california",
      co:"colorado",ct:"connecticut",de:"delaware",fl:"florida",ga:"georgia",
      hi:"hawaii",id:"idaho",il:"illinois",in:"indiana",ia:"iowa",
      ks:"kansas",ky:"kentucky",la:"louisiana",me:"maine",md:"maryland",
      ma:"massachusetts",mi:"michigan",mn:"minnesota",ms:"mississippi",mo:"missouri",
      mt:"montana",ne:"nebraska",nv:"nevada",nh:"new-hampshire",nj:"new-jersey",
      nm:"new-mexico",ny:"new-york",nc:"north-carolina",nd:"north-dakota",oh:"ohio",
      ok:"oklahoma",or:"oregon",pa:"pennsylvania",ri:"rhode-island",sc:"south-carolina",
      sd:"south-dakota",tn:"tennessee",tx:"texas",ut:"utah",vt:"vermont",
      va:"virginia",wa:"washington",wv:"west-virginia",wi:"wisconsin",wy:"wyoming",
    };

    const stateAbbr = (req.query.state as string || '').toLowerCase();
    if (stateAbbr && !stateMap[stateAbbr]) {
      return res.status(400).json({ error: `Unknown state abbreviation: ${stateAbbr}` });
    }

    const entriesToProcess = stateAbbr
      ? [[stateAbbr, stateMap[stateAbbr]]]
      : Object.entries(stateMap);

    const { pool } = await import("./db");
    const PAGE_BATCH = 500;
    let totalUpdated = 0;
    const results: Record<string, number> = {};

    try {
      for (const [abbr, fullName] of entriesToProcess) {
        let cursor = '';
        let stateTotal = 0;
        while (true) {
          const pageRes = await pool.query(
            `SELECT id FROM pages WHERE website_id = $1 AND status = 'published' AND id > $2 ORDER BY id LIMIT $3`,
            [websiteId, cursor, PAGE_BATCH]
          );
          if (pageRes.rows.length === 0) break;
          const pageIds = pageRes.rows.map((r: any) => r.id);
          cursor = pageIds[pageIds.length - 1];

          const result = await pool.query(`
            UPDATE page_versions
            SET content_html = regexp_replace(
              content_html,
              '(href="/[^"]*-in-[^"]*)-${abbr}"',
              E'\\\\1-${fullName}"',
              'g'
            )
            WHERE is_active = true
            AND page_id = ANY($1::text[])
            AND content_html LIKE $2
          `, [pageIds, `%-${abbr}"%`]);
          stateTotal += result.rowCount ?? 0;
        }
        if (stateTotal > 0) {
          results[`${abbr} → ${fullName}`] = stateTotal;
          totalUpdated += stateTotal;
        }
      }
      res.json({ status: "done", totalUpdated, results });
    } catch (err: any) {
      console.error(`[fix-related-links] Error:`, err);
      res.status(500).json({ error: err.message, totalUpdated, results });
    }
  });

  // ── Admin: fix brand name in titles, meta descriptions, and content ──
  app.post("/api/admin/fix-brand-name/:websiteId", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const { websiteId } = req.params;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const oldName = (req.query.old as string) || website.domain;
    const brand = await storage.getBrandProfile(website.brandProfileId as string);
    const newName = (req.query.new as string) || brand?.name || website.name || website.domain;
    if (oldName === newName) return res.json({ message: "Nothing to change", oldName, newName });

    const { pool } = await import("./db");
    res.json({ message: "Started brand name fix in background", oldName, newName, websiteId });

    (async () => {
      try {
        const r1 = await pool.query(
          `UPDATE pages SET title = REPLACE(title, $1, $2), meta_description = REPLACE(meta_description, $1, $2) WHERE website_id = $3 AND (title LIKE $4 OR meta_description LIKE $4)`,
          [oldName, newName, websiteId, `%${oldName}%`]
        );
        console.log(`[fix-brand-name] Updated ${r1.rowCount} page titles/descriptions`);

        const batchSize = 5000;
        let totalContent = 0;
        let hasMore = true;
        while (hasMore) {
          const r2 = await pool.query(
            `UPDATE page_versions SET content_html = REPLACE(content_html, $1, $2) WHERE id IN (SELECT pv.id FROM page_versions pv JOIN pages p ON pv.page_id = p.id WHERE p.website_id = $3 AND pv.content_html LIKE $4 LIMIT $5)`,
            [oldName, newName, websiteId, `%${oldName}%`, batchSize]
          );
          totalContent += r2.rowCount;
          console.log(`[fix-brand-name] Content batch: ${r2.rowCount} versions (total: ${totalContent})`);
          hasMore = r2.rowCount === batchSize;
        }
        console.log(`[fix-brand-name] Done. Pages: ${r1.rowCount}, Content versions: ${totalContent}`);
      } catch (err: any) {
        console.error(`[fix-brand-name] Error:`, err.message);
      }
    })();
  });

  // ── Admin: fix internal links to include proxy path prefix ──
  app.post("/api/admin/fix-link-prefix/:websiteId", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const { websiteId } = req.params;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const prefix = (website.settings as any)?.proxyPath || "";
    if (!prefix) return res.json({ message: "No proxyPath configured, nothing to fix" });

    const { pool } = await import("./db");
    res.json({ message: "Started link prefix fix in background", prefix, websiteId });

    (async () => {
      try {
        const oldPattern = 'href="/';
        const newPattern = `href="${prefix}/`;
        const likeMatch = `%href="/%`;
        const alreadyFixed = `%href="${prefix}/%`;
        const batchSize = 5000;
        let totalUpdated = 0;
        let hasMore = true;
        while (hasMore) {
          const r = await pool.query(
            `UPDATE page_versions SET content_html = REPLACE(content_html, $1, $2) WHERE id IN (SELECT pv.id FROM page_versions pv JOIN pages p ON pv.page_id = p.id WHERE p.website_id = $3 AND pv.content_html LIKE $4 AND pv.content_html NOT LIKE $5 LIMIT $6)`,
            [oldPattern, newPattern, websiteId, likeMatch, alreadyFixed, batchSize]
          );
          totalUpdated += r.rowCount;
          console.log(`[fix-link-prefix] Batch: ${r.rowCount} versions (total: ${totalUpdated})`);
          hasMore = r.rowCount === batchSize;
        }
        console.log(`[fix-link-prefix] Done. Total updated: ${totalUpdated}`);
      } catch (err: any) {
        console.error(`[fix-link-prefix] Error:`, err.message);
      }
    })();
  });

  // ── Admin: regenerate variation banks for a website ──
  app.post("/api/admin/regenerate-banks/:websiteId", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const { websiteId } = req.params;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const serviceName = req.query.service as string | undefined;

    const { pool } = await import("./db");

    let services: string[];
    if (serviceName) {
      services = [serviceName];
    } else {
      const svcRes = await pool.query(
        `SELECT DISTINCT service FROM content_variation_banks WHERE website_id = $1 ORDER BY service`,
        [websiteId]
      );
      services = svcRes.rows.map((r: any) => r.service);
    }

    const [brand, industries] = await Promise.all([
      website.brandProfileId ? storage.getBrandProfile(website.brandProfileId) : Promise.resolve(undefined),
      storage.getIndustries(website.accountId),
    ]);
    const industry = industries[0];
    const brandCtx: BrandContext = {
      brandName: brand?.name,
      brandDescription: brand?.description ?? undefined,
      voiceAndTone: brand?.voiceAndTone ?? undefined,
      industryName: industry?.name,
      industryDescription: industry?.description ?? undefined,
    };

    const results: Record<string, string> = {};
    let done = 0;

    for (const svc of services) {
      try {
        await storage.deleteVariationBanks(websiteId, svc);
        await writeVariationsForService(svc, website.accountId, websiteId, brandCtx);
        results[svc] = "regenerated";
        done++;
        await new Promise(r => setTimeout(r, 15000));
      } catch (err: any) {
        if (err.message?.includes("429")) {
          console.log(`[regenerate-banks] Rate limited on "${svc}", waiting 60s...`);
          await new Promise(r => setTimeout(r, 60000));
          try {
            await storage.deleteVariationBanks(websiteId, svc);
            await writeVariationsForService(svc, website.accountId, websiteId, brandCtx);
            results[svc] = "regenerated (retry)";
            done++;
            await new Promise(r => setTimeout(r, 15000));
          } catch (retryErr: any) {
            results[svc] = `error: ${retryErr.message}`;
          }
        } else {
          results[svc] = `error: ${err.message}`;
        }
      }
    }

    res.json({ status: "done", regenerated: done, total: services.length, results });
  });

  // ── Admin: delete variation banks with service names longer than maxLen ───
  app.post("/api/admin/delete-long-service-banks/:websiteId", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const { websiteId } = req.params;
    const maxLen = parseInt((req.query.maxLen as string) || "100", 10);
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const { pool } = await import("./db");
    const found = await pool.query(
      `SELECT DISTINCT service, length(service) AS len FROM content_variation_banks WHERE website_id = $1 AND length(service) > $2 ORDER BY len DESC`,
      [websiteId, maxLen]
    );
    if (found.rows.length === 0) return res.json({ deleted: 0, message: "No banks found with service name longer than " + maxLen });

    await pool.query(
      `DELETE FROM content_variation_banks WHERE website_id = $1 AND length(service) > $2`,
      [websiteId, maxLen]
    );
    console.log(`[delete-long-banks] Deleted banks for ${found.rows.length} long-name services in website ${websiteId}`);
    res.json({ deleted: found.rows.length, services: found.rows.map((r: any) => r.service.slice(0, 80) + "..."), websiteId });
  });

  // ── Admin: delete pages with slugs longer than minLength ──────────────────
  app.post("/api/admin/delete-long-slug-pages/:websiteId", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const { websiteId } = req.params;
    const minLength = parseInt((req.query.minLength as string) || "300", 10);
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const { pool } = await import("./db");

    // First count how many will be deleted
    const countRes = await pool.query(
      `SELECT COUNT(*) AS c FROM pages WHERE website_id = $1 AND length(slug) >= $2`,
      [websiteId, minLength]
    );
    const count = parseInt(countRes.rows[0].c, 10);

    if (count === 0) return res.json({ deleted: 0, message: "No pages found with slug length >= " + minLength });

    // Delete page versions first, then pages
    await pool.query(
      `DELETE FROM page_versions WHERE page_id IN (SELECT id FROM pages WHERE website_id = $1 AND length(slug) >= $2)`,
      [websiteId, minLength]
    );
    await pool.query(
      `DELETE FROM pages WHERE website_id = $1 AND length(slug) >= $2`,
      [websiteId, minLength]
    );

    console.log(`[delete-long-slugs] Deleted ${count} pages with slug length >= ${minLength} for website ${websiteId}`);
    res.json({ deleted: count, minLength, websiteId });
  });

  // ── One-time admin fix: collapse "State, State" duplicates in state_hub titles/H1s ──
  // Applies globally (all websites) or to a specific website if websiteId is provided.
  app.post("/api/admin/fix-state-hub-titles", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const { websiteId } = req.body as { websiteId?: string };
    const { pool } = await import("./db");

    const countRes = await pool.query(
      `SELECT COUNT(*) AS c FROM pages WHERE page_type = 'state_hub' AND h1 LIKE '% in %, %'${websiteId ? " AND website_id = $1" : ""}`,
      websiteId ? [websiteId] : []
    );
    const toFix = parseInt(countRes.rows[0].c, 10);
    if (toFix === 0) return res.json({ fixed: 0, message: "No pages need fixing." });

    const result = await pool.query(
      `UPDATE pages
       SET
         h1    = replace(h1,    ', ' || split_part(split_part(h1, ' in ', 2), ', ', 1), ''),
         title = replace(title, ', ' || split_part(split_part(h1, ' in ', 2), ', ', 1) || ' | ', ' | ')
       WHERE page_type = 'state_hub'
         AND h1 LIKE '% in %, %'${websiteId ? " AND website_id = $1" : ""}`,
      websiteId ? [websiteId] : []
    );

    const fixed = result.rowCount ?? 0;
    console.log(`[fix-state-hub-titles] Fixed ${fixed} pages${websiteId ? ` for website ${websiteId}` : " globally"}`);
    return res.json({ fixed, message: `Fixed ${fixed} state hub page title${fixed !== 1 ? "s" : ""}.` });
  });

  // ── Automation Settings (per-tenant) ─────────────────────────────────────────

  app.get("/api/websites/:id/automation-settings", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.getWebsite(req.params.id as string);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const { getAutomationSettings, DEFAULT_AUTOMATION_SETTINGS } = await import("./services/automation");
    return res.json({ settings: getAutomationSettings(website), defaults: DEFAULT_AUTOMATION_SETTINGS });
  });

  app.put("/api/websites/:id/automation-settings", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.getWebsite(req.params.id as string);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const current = (website.settings as any) || {};
    const merged = { ...current, automation: { ...(current.automation || {}), ...req.body } };
    const updated = await storage.updateWebsite(req.params.id as string, { settings: merged } as any);
    const { getAutomationSettings } = await import("./services/automation");
    return res.json({ ok: true, settings: getAutomationSettings(updated) });
  });

  app.post("/api/websites/:id/automation/ai-suggest", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: "ANTHROPIC_API_KEY not configured" });
    const websiteId = req.params.id as string;
    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });
    try {
      const { getAutomationSettings } = await import("./services/automation");
      const current = getAutomationSettings(website);
      const totalPages = await storage.getPageCount(websiteId, "published");
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const r = await ai.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: `You are an SEO automation expert. Suggest optimal automation threshold settings for a local SEO content site.

Website: ${website.name || website.domain}
Total published pages: ${totalPages}
Current tier1Threshold: ${current.tier1Threshold}
Current tier2Threshold: ${current.tier2Threshold}
Current fallbackHitThreshold: ${current.fallbackHitThreshold}
Current fallbackHitWindowDays: ${current.fallbackHitWindowDays}
Current autodemoteZeroImpressionDays: ${current.autodemoteZeroImpressionDays}
Current thinBankThreshold: ${current.thinBankThreshold}

Return ONLY valid JSON (no markdown):
{
  "tier1Threshold": 80,
  "tier2Threshold": 50,
  "fallbackHitThreshold": 3,
  "fallbackHitWindowDays": 30,
  "autodemoteZeroImpressionDays": 90,
  "thinBankThreshold": 60,
  "reasoning": "2-3 sentence explanation of why these settings are recommended"
}`,
        }],
      });
      const raw = (r.content[0] as any).text.trim();
      const json = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim());
      return res.json(json);
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "AI error" });
    }
  });

  app.post("/api/accounts/:accountId/ai-checklist", requireAuth, async (req: Request, res: Response) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: "ANTHROPIC_API_KEY not configured" });
    const accountId = req.params.accountId as string;
    try {
      const [websites, services, locations, industries, brands] = await Promise.all([
        storage.getWebsites(accountId),
        storage.getServices(accountId),
        storage.getLocations(accountId),
        storage.getIndustries(accountId),
        storage.getBrandProfiles(accountId),
      ]);
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const r = await ai.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
        messages: [{
          role: "user",
          content: `You are an SEO platform onboarding expert. Based on this account's current setup state, generate a prioritized action checklist.

Account setup state:
- Websites: ${websites.length}
- Brand profiles: ${brands.length}
- Industries: ${industries.length}
- Services: ${services.length}
- Locations: ${locations.length}

Return ONLY valid JSON (no markdown):
{
  "healthScore": 72,
  "summary": "1-2 sentence assessment of account readiness",
  "steps": [
    { "title": "Short action title", "description": "What to do and why it matters for SEO", "priority": "critical", "done": false },
    { "title": "Short action title", "description": "What to do and why it matters for SEO", "priority": "important", "done": true }
  ]
}

healthScore is 0-100. priority must be "critical", "important", or "nice-to-have". Set done=true for items that are already set up based on the state above.`,
        }],
      });
      const raw = (r.content[0] as any).text.trim();
      const json = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim());
      return res.json(json);
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "AI error" });
    }
  });

  // ── Admin Notifications (Auto 5, 6, 7) ────────────────────────────────────────

  app.get("/api/websites/:id/notifications", requireAuth, async (req: Request, res: Response) => {
    const unreadOnly = req.query.unreadOnly === "true";
    const limit = Math.min(parseInt((req.query.limit as string) || "50"), 200);
    const notifications = await storage.getAdminNotifications(req.params.id as string, limit, unreadOnly);
    const unreadCount = await storage.getUnreadNotificationCount(req.params.id as string);
    return res.json({ notifications, unreadCount });
  });

  app.post("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    await storage.markNotificationRead(req.params.id as string);
    return res.json({ ok: true });
  });

  // ── Promotion Queue (Auto 5) ──────────────────────────────────────────────────

  app.get("/api/websites/:id/promotion-queue", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.getWebsite(req.params.id as string);
    if (!website) return res.status(404).json({ error: "Website not found" });
    const { getAutomationSettings } = await import("./services/automation");
    const autoSettings = getAutomationSettings(website);
    const queue = await storage.getPromotionQueue(req.params.id as string, autoSettings.fallbackHitThreshold, autoSettings.fallbackHitWindowDays);
    return res.json({ queue });
  });

  app.post("/api/websites/:id/promotion-queue/:logId/dismiss", requireAuth, async (req: Request, res: Response) => {
    await storage.markFallbackPromoted(req.params.logId as string);
    return res.json({ ok: true });
  });

  // ── Demotion Logs (Auto 6) ────────────────────────────────────────────────────

  app.get("/api/websites/:id/demotion-logs", requireAuth, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) || "50"), 200);
    const logs = await storage.getDemotionLogs(req.params.id as string, limit);
    return res.json({ logs });
  });

  // ── Stripe Webhook ────────────────────────────────────────────────────────────

  app.post("/api/stripe/webhook", async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey || !webhookSecret) {
      return res.status(400).json({ error: "Stripe not configured" });
    }
    let event: any;
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeSecretKey);
      event = stripe.webhooks.constructEvent(req.rawBody as Buffer, sig, webhookSecret);
    } catch (err: any) {
      console.error("[stripe-webhook] signature verification failed:", err.message);
      return res.status(400).json({ error: "Invalid signature" });
    }

    console.log(`[stripe-webhook] event=${event.type} id=${event.id}`);

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const sessionId: string = session.id;
        const customerId: string | null = session.customer ?? null;
        const subscriptionId: string | null = session.subscription ?? null;
        const customerEmail: string =
          session.customer_details?.email || session.customer_email || "unknown";
        const customerName: string | null = session.customer_details?.name ?? null;

        // Dedup: skip if we already have a row for this checkout session
        const existing = await db
          .select({ id: onboardingSubmissions.id, token: onboardingSubmissions.token })
          .from(onboardingSubmissions)
          .where(dEq(onboardingSubmissions.stripeSessionId, sessionId))
          .limit(1);

        if (existing.length > 0) {
          console.log(`[stripe-webhook] Duplicate event for session ${sessionId}, skipping.`);
        } else {
          // Resolve price ID — expand line_items if not present
          let priceId: string | undefined;
          if (session.line_items?.data?.[0]?.price?.id) {
            priceId = session.line_items.data[0].price.id;
          } else {
            try {
              const Stripe = (await import("stripe")).default;
              const stripe = new Stripe(stripeSecretKey);
              const fullSession = await stripe.checkout.sessions.retrieve(sessionId, {
                expand: ["line_items"],
              });
              priceId = (fullSession as any).line_items?.data?.[0]?.price?.id;
            } catch (e: any) {
              console.error(`[stripe-webhook] Failed to expand line_items: ${e?.message}`);
            }
          }

          // Map price ID → plan_type
          const PRICE_LOCAL = process.env.STRIPE_PRICE_LOCAL_LAUNCH || process.env.STRIPE_PRICE_LOCAL || process.env.STRIPE_PRICE_PILOT;
          const PRICE_GROWTH_BUNDLE = process.env.STRIPE_PRICE_GROWTH_BUNDLE;
          const PRICE_BUNDLE = process.env.STRIPE_PRICE_BUNDLE;
          const PRICE_BUNDLE_ANNUAL = process.env.STRIPE_PRICE_BUNDLE_ANNUAL;
          const PRICE_ADDON = process.env.STRIPE_PRICE_ADDON_SITE;
          const PRICE_FOUNDING = process.env.STRIPE_PRICE_FOUNDING_AGENCY;
          let planType = "custom";
          if (priceId && priceId === PRICE_LOCAL) planType = "local_launch";
          else if (priceId && (priceId === PRICE_GROWTH_BUNDLE || priceId === PRICE_BUNDLE)) planType = "growth_bundle";
          else if (priceId && priceId === PRICE_BUNDLE_ANNUAL) planType = "growth_bundle_annual";
          else if (priceId && priceId === PRICE_ADDON) planType = "addon_site";
          else if (priceId && priceId === PRICE_FOUNDING) planType = "founding_agency";

          // Generate unique token (collision check, though astronomically unlikely)
          let token = "";
          for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = randomBytes(32).toString("hex");
            const clash = await db
              .select({ id: onboardingSubmissions.id })
              .from(onboardingSubmissions)
              .where(dEq(onboardingSubmissions.token, candidate))
              .limit(1);
            if (clash.length === 0) {
              token = candidate;
              break;
            }
          }
          if (!token) {
            throw new Error("Failed to generate unique onboarding token after 5 attempts");
          }

          await db.insert(onboardingSubmissions).values({
            token,
            stripeSessionId: sessionId,
            stripeCustomerId: customerId ?? undefined,
            planType,
            status: "pending",
            formData: {
              customer_email: customerEmail,
              customer_name: customerName,
              stripe_subscription_id: subscriptionId,
            },
          });

          console.log(
            `[Stripe Webhook] Checkout completed. Plan: ${planType}, Token: ${token.slice(0, 6)}…, Customer: ${customerEmail}`,
          );
        }
      }

      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object as any;
        const customerId = invoice.customer;
        const email = invoice.customer_email || "unknown";
        console.error(`[stripe-webhook] Payment failed — customer=${customerId} email=${email}`);
      }

      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object as any;
        const customerId = sub.customer;
        console.log(`[stripe-webhook] Subscription cancelled — customer=${customerId}`);
      }
    } catch (err: any) {
      console.error("[stripe-webhook] handler error:", err.message);
    }

    return res.json({ received: true });
  });

  // ── Onboarding redirect (called by /welcome page) ─────────────────────────────

  app.get("/api/stripe/onboarding-redirect", async (req: Request, res: Response) => {
    const sessionId = req.query.session_id;
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "Missing session_id" });
    }
    try {
      const rows = await db
        .select({
          token: onboardingSubmissions.token,
          status: onboardingSubmissions.status,
          planType: onboardingSubmissions.planType,
        })
        .from(onboardingSubmissions)
        .where(dEq(onboardingSubmissions.stripeSessionId, sessionId))
        .limit(1);
      if (rows.length === 0) {
        return res.status(404).json({
          error: "Session not found",
          message: "Your onboarding link is being generated. Please refresh in a few seconds.",
        });
      }
      const row = rows[0];
      return res.json({ token: row.token, status: row.status, plan_type: row.planType });
    } catch (err: any) {
      console.error("[onboarding-redirect] error:", err?.message);
      return res.status(500).json({ error: "lookup_failed" });
    }
  });

  // ── Public Onboarding (token-gated, no auth) ──────────────────────────────────

  app.get("/api/onboard/lookup/:token", async (req: Request, res: Response) => {
    const token = req.params.token;
    if (!token || typeof token !== "string" || token.length < 8) {
      return res.status(400).json({ error: "invalid_token" });
    }
    try {
      const rows = await db
        .select({
          status: onboardingSubmissions.status,
          planType: onboardingSubmissions.planType,
          formData: onboardingSubmissions.formData,
          submittedAt: onboardingSubmissions.submittedAt,
        })
        .from(onboardingSubmissions)
        .where(dEq(onboardingSubmissions.token, token))
        .limit(1);
      if (rows.length === 0) {
        return res.status(404).json({ error: "not_found" });
      }
      const r = rows[0];
      return res.json({
        status: r.status,
        plan_type: r.planType,
        form_data: r.formData,
        submitted_at: r.submittedAt,
      });
    } catch (err: any) {
      console.error("[onboard-lookup] error:", err?.message);
      return res.status(500).json({ error: "lookup_failed" });
    }
  });

  // ─── PHASE 5: Public status endpoint (polled by confirmation page) ──────
  app.get("/api/onboard/status", async (req: Request, res: Response) => {
    const token = String(req.query.token || "").trim();
    if (!token || token.length < 8) {
      return res.status(400).json({ error: "invalid_token" });
    }
    try {
      const rows = await db
        .select({
          id: onboardingSubmissions.id,
          status: onboardingSubmissions.status,
          readinessScore: onboardingSubmissions.readinessScore,
          readinessResult: onboardingSubmissions.readinessResult,
          websiteId: onboardingSubmissions.websiteId,
          generationStartedAt: onboardingSubmissions.generationStartedAt,
          governorResults: onboardingSubmissions.governorResults,
        })
        .from(onboardingSubmissions)
        .where(dEq(onboardingSubmissions.token, token))
        .limit(1);
      if (rows.length === 0) {
        return res.status(404).json({ error: "not_found" });
      }
      const r = rows[0];
      const result: any = r.readinessResult || {};
      const messageMap: Record<string, string> = {
        pending: "Waiting for onboarding form to be completed.",
        submitted: "Your information was received. Setting up your account now.",
        creating: "Building your account and checking readiness...",
        ready_for_scoring: "Checking your account readiness.",
        ready_for_generation: "Your account is ready. Page generation is starting now — this typically takes 1–3 hours depending on your service area size.",
        needs_info: "We need a few more details before we can generate your pages. See the items listed below, then reply to your welcome email or call (435) 999-5348 to update your information.",
        generating: "Our content engine is generating your pages right now. This typically takes 1–3 hours. You'll receive an email when drafts are ready for review.",
        generated_draft_only: "All pages have been generated as drafts and quality-scored. Our team is now reviewing them before launching to the public. You'll receive an email when the first wave goes live.",
        published_live: "Your pages are live and being indexed by search engines.",
      };

      // Phase 6 — include page_counts block once pages exist
      let pageCounts: any = undefined;
      if ((r.status === "generating" || r.status === "generated_draft_only" || r.status === "published_live") && r.websiteId) {
        try {
          const [counts] = (await db.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE is_draft = true OR status = 'draft')::int AS total_drafted,
              COUNT(*) FILTER (WHERE tier = 1)::int AS tier1_eligible,
              COUNT(*) FILTER (WHERE tier = 2)::int AS tier2,
              COUNT(*) FILTER (WHERE tier = 3)::int AS tier3,
              COALESCE(AVG(quality_score) FILTER (WHERE quality_score IS NOT NULL), 0)::int AS average_score
            FROM pages
            WHERE website_id = ${r.websiteId}
          `).then((res: any) => (res.rows ? res.rows : res))) as any;
          if (counts && (counts.total_drafted || 0) > 0) {
            pageCounts = {
              total_drafted: counts.total_drafted || 0,
              tier1_eligible: counts.tier1_eligible || 0,
              tier2: counts.tier2 || 0,
              tier3: counts.tier3 || 0,
              average_score: counts.average_score || 0,
            };
          }
        } catch (e: any) {
          console.error("[onboard-status] page_counts query failed:", e?.message);
        }
      }

      // Phase 7 — wave info from governor results
      let waveInfo: any = undefined;
      const gr = (r.governorResults as any) || {};
      if (r.status === "published_live" || r.status === "generated_draft_only") {
        const g3 = gr.governor_3_launch_cap;
        const g1 = gr.governor_1_service_gate;
        const waveUnlocks = Array.isArray(gr.wave_unlocks) ? gr.wave_unlocks : [];
        const totalWavesPublished = (g3?.wave1_published ? 1 : 0) + waveUnlocks.length;
        const lastWavePages = waveUnlocks.length > 0
          ? waveUnlocks[waveUnlocks.length - 1].pages_published
          : g3?.wave1_published || 0;

        // Compute next wave date if we have a first publish date
        let nextWaveAt: string | undefined;
        if (r.websiteId) {
          try {
            const [w] = await db.execute(sql`
              SELECT first_publish_at FROM websites WHERE id = ${r.websiteId} LIMIT 1
            `).then((res: any) => (res.rows ? res.rows : res)) as any[];
            if (w?.first_publish_at) {
              const fp = new Date(w.first_publish_at);
              const currentMaxWave = Math.max(1, totalWavesPublished);
              const next = new Date(fp.getTime() + currentMaxWave * 14 * 24 * 3600 * 1000);
              nextWaveAt = next.toISOString();
            }
          } catch { /* non-fatal */ }
        }

        waveInfo = {
          current_wave: Math.max(1, totalWavesPublished),
          last_wave_pages_published: lastWavePages,
          ...(nextWaveAt ? { next_wave_estimated_at: nextWaveAt } : {}),
        };

        // Customer-friendly blocked-services message (no AI/bank/completeness jargon)
        if (g1 && Array.isArray(g1.blocked_services) && g1.blocked_services.length > 0) {
          const blocked = g1.blocked_services.map((b: any) => b.name);
          waveInfo.content_review_pending = {
            services: blocked,
            message: blocked.length === 1
              ? `Pages for "${blocked[0]}" are still being polished by our content team and will go live in an upcoming wave.`
              : `Pages for ${blocked.length} services (${blocked.slice(0, 3).join(", ")}${blocked.length > 3 ? ", and others" : ""}) are still being polished by our content team and will go live in upcoming waves.`,
          };
        }
      }

      return res.json({
        status: r.status,
        readiness_score: r.readinessScore || 0,
        gaps: Array.isArray(result.gaps) ? result.gaps : [],
        strengths: Array.isArray(result.strengths) ? result.strengths : [],
        message: messageMap[r.status || ""] || "Processing your account.",
        ...(pageCounts ? { page_counts: pageCounts } : {}),
        ...(waveInfo ? { wave_info: waveInfo } : {}),
        // Phase 9 — public customer dashboard URL
        dashboard_url: `/dashboard/${token}`,
      });
    } catch (err: any) {
      console.error("[onboard-status] error:", err?.message);
      return res.status(500).json({ error: "lookup_failed" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 9 — Public customer dashboard data (no auth, token-based)
  // ═══════════════════════════════════════════════════════════════════════
  app.get("/api/dashboard/data", async (req: Request, res: Response) => {
    const token = String(req.query.token || "").trim();
    if (!token || token.length < 8) {
      return res.status(400).json({ error: "invalid_token" });
    }
    try {
      const [sub] = await db
        .select()
        .from(onboardingSubmissions)
        .where(dEq(onboardingSubmissions.token, token))
        .limit(1);
      if (!sub) return res.status(404).json({ error: "not_found" });

      const websiteId = sub.websiteId!;
      const accountId = sub.accountId!;
      const website = websiteId ? await storage.getWebsite(websiteId) : null;
      const profiles = accountId ? await storage.getBrandProfiles(accountId) : [];
      const brand = profiles[0];

      // Page stats
      let pageStats: any = null;
      if (websiteId) {
        const [stats] = (await db.execute(sql`
          SELECT
            COUNT(*)::int AS total_pages,
            COUNT(*) FILTER (WHERE is_draft = false)::int AS live_pages,
            COUNT(*) FILTER (WHERE is_draft = true)::int AS draft_pages,
            COUNT(*) FILTER (WHERE tier = 1 AND is_draft = false)::int AS tier1_live,
            COUNT(*) FILTER (WHERE tier = 2 AND is_draft = false)::int AS tier2_live,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_this_week,
            COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '7 days' AND is_draft = false AND publish_wave > 0)::int AS promoted_this_week,
            COALESCE(AVG(quality_score), 0)::int AS avg_quality
          FROM pages WHERE website_id = ${websiteId}
        `).then((r: any) => (r.rows ? r.rows : r))) as any;
        pageStats = stats;
      }

      // Health, warmup, protection, gap report
      let health: any = null;
      let warm: any = null;
      let prot: any = null;
      try {
        if (websiteId) {
          const { getLatestHealthScore } = await import("./services/launch-health");
          health = await getLatestHealthScore(websiteId);
          const { getWarmupPageLimit, getProtectionModeThresholds } = await import("./services/safety-rails");
          warm = await getWarmupPageLimit(websiteId);
          prot = await getProtectionModeThresholds(websiteId);
        }
      } catch (e: any) { console.error("[dashboard/data] sub-fetch failed:", e?.message); }

      // Recent live pages
      let recentPages: any[] = [];
      if (websiteId) {
        recentPages = (await db.execute(sql`
          SELECT slug, title, tier, published_at, quality_score
          FROM pages WHERE website_id = ${websiteId} AND is_draft = false
          ORDER BY published_at DESC NULLS LAST LIMIT 10
        `).then((r: any) => (r.rows ? r.rows : r))) as any[];
      }

      // Sanitize warmup limit for client display
      const warmupLimitDisplay = warm && warm.current_limit === Number.MAX_SAFE_INTEGER ? null : warm?.current_limit ?? null;

      return res.json({
        brand_name: brand?.name || website?.name || "Your Account",
        domain: website?.domain || "",
        status: sub.status,
        readiness_score: sub.readinessScore || 0,
        page_stats: pageStats,
        recent_pages: recentPages.map((p) => ({
          slug: p.slug,
          title: p.title,
          tier: p.tier,
          published_at: p.published_at,
          quality_score: p.quality_score,
        })),
        launch_health: health ? {
          score: health.score,
          // Customer-safe summary only; internal breakdown (which references "completeness")
          // is intentionally not exposed to customers.
          message: (health.breakdown as any)?.message
            || (health.score >= 70 ? "Your account is performing well."
                : health.score >= 50 ? "Your account is on track. A few items below could give it a boost."
                : "Your account needs attention — see action items below."),
        } : null,
        warmup: warm ? {
          active: warm.warmup_active,
          day: warm.warmup_day,
          page_limit: warmupLimitDisplay,
          next_increase_day: warm.next_tier_day,
          next_increase_limit: warm.next_tier_limit,
          expires_at: warm.expires_at,
        } : null,
        protection: prot ? {
          active: prot.protection_mode,
          expires_in_days: prot.protection_expires_in_days ?? null,
        } : null,
        gap_report: sub.gapReport || null,
        wave_info: ((sub.governorResults as any)?.governor_3_launch_cap) ? {
          waves_published: 1 + (Array.isArray((sub.governorResults as any)?.wave_unlocks) ? (sub.governorResults as any).wave_unlocks.length : 0),
        } : null,
        booking_url: process.env.VITE_BOOKING_URL || null,
      });
    } catch (err: any) {
      console.error("[dashboard/data] error:", err?.message);
      return res.status(500).json({ error: "lookup_failed" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 8/9 — Admin-only endpoints
  // ═══════════════════════════════════════════════════════════════════════

  // ── Admin Test Tool — Onboarding Pipeline Simulator ──────────────────────

  app.post("/api/admin/test/create-submission", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { planType, business, services, coverage } = req.body;
      const { randomBytes } = await import("crypto");
      const token = randomBytes(32).toString("hex");
      const formData = { customer_email: business?.email || "test@example.com", customer_name: business?.legal_name || "Test User", business: business || {}, services: Array.isArray(services) ? services : [], coverage: coverage || {} };
      const [row] = await db.insert(onboardingSubmissions).values({ token, stripeSessionId: "cs_test_manual_" + token.slice(0, 8), planType: planType || "local_launch", status: "pending", formData } as any).returning();
      return res.json({ ok: true, submission: row });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/test/submissions", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const rows = await db.select().from(onboardingSubmissions).where(like(onboardingSubmissions.stripeSessionId, "cs_test_manual%")).orderBy(desc(onboardingSubmissions.createdAt)).limit(50);
      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/test/submission/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const [sub] = await db.select().from(onboardingSubmissions).where(dEq(onboardingSubmissions.id, req.params.id)).limit(1);
      if (!sub) return res.status(404).json({ error: "not_found" });
      let account = null, website = null, pageStats = null;
      if (sub.accountId) account = await storage.getAccount(sub.accountId);
      if (sub.websiteId) {
        website = await storage.getWebsite(sub.websiteId);
        const [stats] = await db.execute(sql`SELECT COUNT(*) FILTER (WHERE is_draft=false) AS published, COUNT(*) FILTER (WHERE is_draft=true) AS draft, COUNT(*) AS total FROM pages WHERE website_id=${sub.websiteId}`);
        pageStats = stats;
      }
      return res.json({ submission: sub, account, website, pageStats });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/test/run-phase/:phase", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const phase = Number(req.params.phase);
    const { submissionId } = req.body;
    if (!submissionId) return res.status(400).json({ error: "submissionId required" });
    try {
      if (phase === 4) {
        // Advance pending → submitted then run auto-create
        await db.update(onboardingSubmissions).set({ status: "submitted", submittedAt: new Date() } as any).where(sql`id=${submissionId} AND status='pending'`);
        const { processOnboardingSubmission } = await import("./services/onboarding");
        const result = await processOnboardingSubmission(submissionId);
        return res.json(result);
      }
      if (phase === 5) {
        const { calculateReadinessScore } = await import("./services/onboarding");
        const result = await calculateReadinessScore(submissionId);
        return res.json(result);
      }
      if (phase === 6) {
        const { overwrite } = req.body;
        if (overwrite) {
          // Reset status so the idempotency guard doesn't block a re-run
          await db.update(onboardingSubmissions)
            .set({ status: "ready_for_generation" } as any)
            .where(dEq(onboardingSubmissions.id, submissionId));
        }
        const { runOnboardingGeneration } = await import("./services/onboarding");
        const result = await runOnboardingGeneration(submissionId, { overwrite: !!overwrite });
        return res.json(result);
      }
      if (phase === 7) {
        const [sub] = await db.select({ websiteId: onboardingSubmissions.websiteId }).from(onboardingSubmissions).where(dEq(onboardingSubmissions.id, submissionId)).limit(1);
        if (!sub?.websiteId) return res.status(400).json({ error: "No websiteId on submission" });
        const { runLaunchGovernors } = await import("./services/launch-governors");
        const result = await runLaunchGovernors(sub.websiteId);
        return res.json(result);
      }
      if (phase === 8) {
        const [sub] = await db.select({ websiteId: onboardingSubmissions.websiteId }).from(onboardingSubmissions).where(dEq(onboardingSubmissions.id, submissionId)).limit(1);
        if (!sub?.websiteId) return res.status(400).json({ error: "No websiteId on submission" });
        const { detectDuplicateIntent, getWarmupPageLimit } = await import("./services/safety-rails");
        const [dupeResult, warmup] = await Promise.all([detectDuplicateIntent(sub.websiteId), getWarmupPageLimit(sub.websiteId)]);
        return res.json({ duplicates: dupeResult, warmup });
      }
      if (phase === 9) {
        const [sub] = await db.select({ websiteId: onboardingSubmissions.websiteId }).from(onboardingSubmissions).where(dEq(onboardingSubmissions.id, submissionId)).limit(1);
        if (!sub?.websiteId) return res.status(400).json({ error: "No websiteId on submission" });
        const { calculateLaunchHealthScore } = await import("./services/launch-health");
        const result = await calculateLaunchHealthScore(sub.websiteId);
        return res.json(result);
      }
      return res.status(400).json({ error: "Unknown phase: " + phase });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/test/submission/:id/pages", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const [sub] = await db.select({ websiteId: onboardingSubmissions.websiteId }).from(onboardingSubmissions).where(dEq(onboardingSubmissions.id, req.params.id)).limit(1);
      if (!sub) return res.status(404).json({ error: "not_found" });
      if (!sub.websiteId) return res.status(404).json({ error: "No website on this submission yet" });
      const allPages = await db.select({ slug: pages.slug, title: pages.title, isDraft: pages.isDraft, tier: pages.tier, qualityScore: pages.qualityScore, publishWave: pages.publishWave }).from(pages).where(dEq(pages.websiteId, sub.websiteId));
      const stats = {
        total: allPages.length,
        draft: allPages.filter(p => p.isDraft).length,
        published: allPages.filter(p => !p.isDraft).length,
        tier1: allPages.filter(p => p.tier === 1).length,
        tier2: allPages.filter(p => p.tier === 2).length,
        tier3: allPages.filter(p => p.tier === 3).length,
        averageScore: allPages.length > 0 ? Math.round(allPages.reduce((s, p) => s + (p.qualityScore || 0), 0) / allPages.length) : 0,
      };
      const samplePages = allPages.slice(0, 20);
      return res.json({ stats, samplePages });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/test/submission/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      await db.delete(onboardingSubmissions).where(dEq(onboardingSubmissions.id, req.params.id));
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Clear duplicate flags on selected pages (or all on a website)
  app.post("/api/admin/create-test-onboarding", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const token = req.body?.token || "test-token-live-check-001";
      await db.execute(sql`
        INSERT INTO onboarding_submissions (id, token, stripe_session_id, plan_type, status, form_data, created_at)
        VALUES (gen_random_uuid(), ${token}, 'cs_test_manual', 'local_launch', 'pending',
          '{"customer_email":"test@example.com","customer_name":"Test User"}'::jsonb, now())
        ON CONFLICT DO NOTHING
      `);
      return res.json({ ok: true, token, url: `/onboard/${token}` });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/seed-test-onboarding", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const token = (req.query.token as string) || "test-token-live-check-001";
      const landingDomain = (process.env.LANDING_DOMAIN || "spotonnexus.com").toLowerCase();
      await db.execute(sql`
        INSERT INTO onboarding_submissions (id, token, stripe_session_id, plan_type, status, form_data, created_at)
        VALUES (gen_random_uuid(), ${token}, 'cs_test_manual', 'local_launch', 'pending',
          '{"customer_email":"test@example.com","customer_name":"Test User"}'::jsonb, now())
        ON CONFLICT DO NOTHING
      `);
      return res.redirect(`https://${landingDomain}/onboard/${token}`);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/duplicates/clear", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const websiteId = String(req.body?.websiteId || "").trim();
      const pageIds = Array.isArray(req.body?.pageIds) ? req.body.pageIds : [];
      if (!websiteId) return res.status(400).json({ error: "websiteId_required" });
      let cleared = 0;
      if (pageIds.length > 0) {
        const r = await db.execute(sql`
          UPDATE pages SET duplicate_flag = false, duplicate_of_slug = NULL, duplicate_similarity = NULL,
            draft_reason = CASE WHEN draft_reason = 'duplicate_intent' THEN NULL ELSE draft_reason END
          WHERE website_id = ${websiteId} AND id = ANY(${pageIds})
        `).then((x: any) => x);
        cleared = (r as any)?.rowCount || pageIds.length;
      } else {
        const r = await db.execute(sql`
          UPDATE pages SET duplicate_flag = false, duplicate_of_slug = NULL, duplicate_similarity = NULL,
            draft_reason = CASE WHEN draft_reason = 'duplicate_intent' THEN NULL ELSE draft_reason END
          WHERE website_id = ${websiteId} AND duplicate_flag = true
        `).then((x: any) => x);
        cleared = (r as any)?.rowCount || 0;
      }
      return res.json({ cleared });
    } catch (err: any) {
      console.error("[admin/duplicates/clear] error:", err?.message);
      return res.status(500).json({ error: "clear_failed" });
    }
  });

  // List duplicate-flagged pages
  app.get("/api/admin/websites/:id/duplicates", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const rows = (await db.execute(sql`
        SELECT id, slug, title, duplicate_of_slug, duplicate_similarity, quality_score, tier, is_draft
        FROM pages WHERE website_id = ${req.params.id} AND duplicate_flag = true
        ORDER BY duplicate_similarity DESC NULLS LAST LIMIT 500
      `).then((r: any) => (r.rows ? r.rows : r))) as any[];
      return res.json({ duplicates: rows });
    } catch (err: any) {
      return res.status(500).json({ error: "fetch_failed" });
    }
  });

  // Disable warmup mode on a website
  app.post("/api/admin/websites/:id/disable-warmup", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      await db.execute(sql`UPDATE websites SET warmup_mode = false, warmup_expires_at = NULL WHERE id = ${req.params.id}`);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: "disable_failed" });
    }
  });

  // Disable protection mode on a website
  app.post("/api/admin/websites/:id/disable-protection", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      await db.execute(sql`UPDATE websites SET protection_mode = false, protection_expires_at = NULL WHERE id = ${req.params.id}`);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: "disable_failed" });
    }
  });

  // Run launch health calculation on demand
  app.post("/api/admin/websites/:id/run-launch-health", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { calculateLaunchHealthScore } = await import("./services/launch-health");
      const breakdown = await calculateLaunchHealthScore(req.params.id);
      return res.json({ breakdown });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "calc_failed" });
    }
  });

  // Generate (and try to send) a client digest on demand
  app.post("/api/admin/websites/:id/send-digest", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { generateClientWeeklyDigest } = await import("./services/client-digest");
      const result = await generateClientWeeklyDigest(req.params.id);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "send_failed" });
    }
  });

  // Re-send an existing digest by id
  app.post("/api/admin/digests/:id/resend", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { sendDigestById } = await import("./services/client-digest");
      const sent = await sendDigestById(req.params.id);
      return res.json({ sent });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "send_failed" });
    }
  });

  // List digests
  app.get("/api/admin/digests", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const websiteId = String(req.query.websiteId || "").trim();
      const rows = (await db.execute(websiteId
        ? sql`SELECT id, website_id, recipient_email, subject, status, sent_at, created_at FROM client_weekly_digests WHERE website_id = ${websiteId} ORDER BY created_at DESC LIMIT 100`
        : sql`SELECT id, website_id, recipient_email, subject, status, sent_at, created_at FROM client_weekly_digests ORDER BY created_at DESC LIMIT 100`
      ).then((r: any) => (r.rows ? r.rows : r))) as any[];
      return res.json({ digests: rows });
    } catch (err: any) {
      return res.status(500).json({ error: "list_failed" });
    }
  });

  // ─── PHASE 5: Admin — list onboarding submissions ───────────────────────
  app.get("/api/admin/onboarding/list", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          id: onboardingSubmissions.id,
          token: onboardingSubmissions.token,
          planType: onboardingSubmissions.planType,
          status: onboardingSubmissions.status,
          readinessScore: onboardingSubmissions.readinessScore,
          readinessResult: onboardingSubmissions.readinessResult,
          accountId: onboardingSubmissions.accountId,
          websiteId: onboardingSubmissions.websiteId,
          formData: onboardingSubmissions.formData,
          onboardingNotes: onboardingSubmissions.onboardingNotes,
          createdAt: onboardingSubmissions.createdAt,
          submittedAt: onboardingSubmissions.submittedAt,
        })
        .from(onboardingSubmissions)
        .orderBy(desc(onboardingSubmissions.createdAt))
        .limit(200);
      return res.json({ submissions: rows });
    } catch (err: any) {
      console.error("[admin-onboarding-list] error:", err?.message);
      return res.status(500).json({ error: "list_failed" });
    }
  });

  // ─── PHASE 5: Admin — manual override needs_info → ready_for_generation ──
  // Two-step flow: GET (no override flag) returns current state + gaps so the
  // admin can review the warning. POST with { submissionId, confirm: true }
  // applies the override.
  app.post("/api/admin/onboarding/override", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const submissionId = String(req.body?.submissionId || "").trim();
    const confirm = req.body?.confirm === true;
    if (!submissionId) return res.status(400).json({ error: "missing_submission_id" });

    try {
      const [sub] = await db
        .select()
        .from(onboardingSubmissions)
        .where(dEq(onboardingSubmissions.id, submissionId))
        .limit(1);
      if (!sub) return res.status(404).json({ error: "not_found" });
      if (sub.status !== "needs_info") {
        return res.status(409).json({ error: "invalid_status", message: `Submission status is '${sub.status}', expected 'needs_info'.` });
      }

      const result: any = sub.readinessResult || {};
      const gaps: any[] = Array.isArray(result.gaps) ? result.gaps : [];
      const score = sub.readinessScore || 0;
      const warning = `This submission scored ${score}/100. The following gaps were identified:\n${gaps.length ? gaps.map((g: any) => `• ${g.message}`).join("\n") : "(none recorded)"}\nOverriding will allow page generation to proceed despite these gaps.`;

      if (!confirm) {
        return res.json({ requires_confirmation: true, score, gaps, warning });
      }

      const overrideTs = new Date().toISOString();
      const overrideNote = `\n\nMANUAL OVERRIDE by admin at ${overrideTs}. Previous score: ${score}.`;
      const newNotes = (sub.onboardingNotes || "") + overrideNote;

      await db
        .update(onboardingSubmissions)
        .set({ status: "ready_for_generation", onboardingNotes: newNotes })
        .where(dEq(onboardingSubmissions.id, submissionId));

      if (sub.websiteId) {
        await db
          .update(websites)
          .set({ onboardingStatus: "ready_for_generation" })
          .where(dEq(websites.id, sub.websiteId));
      }

      console.log(`[Onboarding] Submission ${submissionId} OVERRIDDEN by admin. Previous score: ${score}/100. Status now: ready_for_generation.`);

      // Phase 6 — fire-and-forget background generation pipeline (admin override path)
      setImmediate(async () => {
        try {
          const { runOnboardingGeneration } = await import("./services/onboarding");
          await runOnboardingGeneration(submissionId);
        } catch (err: any) {
          console.error(`[Onboarding Generation] Admin override pipeline failed for ${submissionId}:`, err?.message);
        }
      });

      return res.json({ success: true, status: "ready_for_generation", previous_score: score });
    } catch (err: any) {
      console.error("[admin-onboarding-override] error:", err?.message);
      return res.status(500).json({ error: "override_failed", message: err?.message });
    }
  });

  app.post("/api/onboard/submit", async (req: Request, res: Response) => {
    const body = req.body as {
      token?: string;
      business?: any;
      services?: string[];
      coverage?: any;
    };
    const { token, business, services, coverage } = body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "missing_token" });
    }
    if (!business || typeof business !== "object") {
      return res.status(400).json({ error: "missing_business" });
    }
    if (!Array.isArray(services) || services.length < 3) {
      return res.status(400).json({ error: "need_at_least_3_services" });
    }
    if (!coverage || typeof coverage !== "object") {
      return res.status(400).json({ error: "missing_coverage" });
    }
    // Required business fields
    const required = ["legal_name", "domain", "phone", "email", "city", "state", "industry"];
    for (const k of required) {
      if (!business[k] || typeof business[k] !== "string" || !business[k].trim()) {
        return res.status(400).json({ error: `missing_business_${k}` });
      }
    }

    try {
      const rows = await db
        .select({
          id: onboardingSubmissions.id,
          status: onboardingSubmissions.status,
          existingFormData: onboardingSubmissions.formData,
        })
        .from(onboardingSubmissions)
        .where(dEq(onboardingSubmissions.token, token))
        .limit(1);
      if (rows.length === 0) {
        return res.status(400).json({ error: "invalid_token" });
      }
      const row = rows[0];
      if (row.status !== "pending") {
        return res.status(400).json({ error: "already_submitted", status: row.status });
      }

      // Merge so we keep customer_email/customer_name from the webhook
      const merged = {
        ...(row.existingFormData as Record<string, any> | null ?? {}),
        business,
        services,
        coverage,
      };

      await db
        .update(onboardingSubmissions)
        .set({
          formData: merged,
          status: "submitted",
          submittedAt: new Date(),
        })
        .where(dEq(onboardingSubmissions.token, token));

      console.log(`[onboard-submit] token=${token.slice(0, 8)}… plan=${business.industry} services=${services.length}`);
      res.json({ success: true, message: "Onboarding submitted successfully" });

      // Fire-and-forget: auto-create account/website/brand/services/locations in background.
      // Customer does not wait for this. On failure, status is set to 'needs_info'.
      processOnboardingSubmission(row.id).catch((err: any) => {
        console.error(`[onboard-submit] background auto-create failed for ${row.id}:`, err?.message || err);
      });
      return;
    } catch (err: any) {
      console.error("[onboard-submit] error:", err?.message);
      return res.status(500).json({ error: "submit_failed" });
    }
  });

  // ── Stripe Checkout ───────────────────────────────────────────────────────────

  app.get("/api/stripe/config", async (_req: Request, res: Response) => {
    const FOUNDING_SLOTS_TOTAL = 9;
    let foundingAgencySlotsRemaining = FOUNDING_SLOTS_TOTAL;
    try {
      const [{ cnt }] = await db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(onboardingSubmissions)
        .where(dEq(onboardingSubmissions.planType, "founding_agency"));
      foundingAgencySlotsRemaining = Math.max(0, FOUNDING_SLOTS_TOTAL - (cnt ?? 0));
    } catch {}
    res.json({
      addonSiteEnabled: !!process.env.STRIPE_PRICE_ADDON_SITE,
      bundleAnnualEnabled: !!process.env.STRIPE_PRICE_BUNDLE_ANNUAL,
      foundingAgencyEnabled: !!process.env.STRIPE_PRICE_FOUNDING_AGENCY,
      foundingAgencySlotsRemaining,
    });
  });

  app.post("/api/stripe/create-checkout-session", async (req: Request, res: Response) => {
    const { tier } = req.body as { tier?: string };

    // Founding Agency slot guard
    if (tier === "foundingAgency") {
      const FOUNDING_SLOTS_TOTAL = 9;
      try {
        const [{ cnt }] = await db
          .select({ cnt: sql<number>`count(*)::int` })
          .from(onboardingSubmissions)
          .where(dEq(onboardingSubmissions.planType, "founding_agency"));
        if ((cnt ?? 0) >= FOUNDING_SLOTS_TOTAL) {
          return res.json({ error: "slots_full" });
        }
      } catch {}
    }

    const priceIdMap: Record<string, string | undefined> = {
      localLaunch: process.env.STRIPE_PRICE_LOCAL_LAUNCH || process.env.STRIPE_PRICE_PILOT,
      bundle: process.env.STRIPE_PRICE_GROWTH_BUNDLE || process.env.STRIPE_PRICE_BUNDLE,
      bundleAnnual: process.env.STRIPE_PRICE_BUNDLE_ANNUAL,
      pilot: process.env.STRIPE_PRICE_PILOT,
      addonSite: process.env.STRIPE_PRICE_ADDON_SITE,
      foundingAgency: process.env.STRIPE_PRICE_FOUNDING_AGENCY,
    };
    const priceId = tier ? priceIdMap[tier] : undefined;
    if (!priceId) {
      return res.json({ error: "coming_soon" });
    }
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.json({ error: "coming_soon" });
    }
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeSecretKey);
      const origin = req.headers.origin || "https://spotonnexus.com";
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/#pricing`,
      });
      return res.json({ url: session.url });
    } catch (err: any) {
      console.error("[stripe] checkout session error:", err?.message);
      return res.status(500).json({ error: "checkout_failed" });
    }
  });

  // ── Phase 10 routes: call tracking, form tracking, leads, dashboards ──────
  app.use("/api/call-tracking", callTrackingRouter);
  app.use("/api/form-tracking", formTrackingRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/dashboard", dashboardAgencyRouter);
  app.use("/api/admin", dashboardAdminRouter);
  app.use("/widget", widgetRouter);

  return httpServer;
}
