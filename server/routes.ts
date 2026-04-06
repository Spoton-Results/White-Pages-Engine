import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { sessionMiddleware, requireAuth, requireSuperAdmin, loginUser, hashPassword } from "./auth";
import * as storage from "./storage";
import { runGenerationJob } from "./services/generation";
import { generateBlueprint, suggestServices, generateQueryClusters } from "./services/claude";
import { buildVariationPage } from "./services/variation-engine";
import { writeVariationsForService, BrandContext } from "./services/variation-writer";
import { generateSitemapsForWebsite, generateRobotsTxt, URLS_PER_SITEMAP } from "./services/sitemap";
import { isR2Configured } from "./services/r2";
import {
  insertAccountSchema, insertUserSchema, insertBrandProfileSchema,
  insertWebsiteSchema, insertLocationSchema, insertServiceSchema,
  insertIndustrySchema, insertQueryClusterSchema, insertBlueprintSchema,
  insertPageSchema, insertGenerationJobSchema,
} from "@shared/schema";
import { z } from "zod";

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
  siblingServices: { title: string; slug: string }[];
  stateDisplayName?: string;
}

async function resolveNavData(page: any, websiteId: string): Promise<[NavData["statePages"], NavData["cityPages"], string, NavData["siblingServices"]]> {
  const statePages = await storage.getStateNavPages(websiteId);
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

function renderPageHtml(page: any, version: any, website: any, brand: any, navData: NavData = { statePages: [], cityPages: [], siblingServices: [] }): string {
  const brandName = brand?.name || website.name || website.domain;
  const primaryColor = brand?.primaryColor || "#2563eb";
  const phone = brand?.phone || (website.settings as any)?.phone || "";
  const tagline = brand?.tagline || (website.settings as any)?.tagline || "";
  const mainWebsiteUrl = (website.settings as any)?.mainWebsiteUrl || brand?.customFields?.websiteUrl || "";
  const ctaHeading = (website.settings as any)?.ctaHeading || `Visit ${brandName}`;
  const ctaText = (website.settings as any)?.ctaText || "See how we can help your business grow.";
  const ctaButtonLabel = (website.settings as any)?.ctaButtonLabel || "Learn More";
  const demoBannerUrl = (website.settings as any)?.demoBannerUrl || "";
  const demoBannerHeading = (website.settings as any)?.demoBannerHeading || "See This Platform in Action";
  const demoBannerSubtext = (website.settings as any)?.demoBannerSubtext || "This page was generated automatically. Want 100,000+ pages like it for your business?";
  const demoBannerButtonLabel = (website.settings as any)?.demoBannerButtonLabel || "Try the Live Demo →";

  const parentDomain = (website.settings as any)?.parentDomain;
  const proxyPath = (website.settings as any)?.proxyPath || "";
  const canonicalBase = parentDomain ? `https://${parentDomain}${proxyPath}` : `https://${website.domain}`;
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${page.title}</title>
  <meta name="description" content="${(page.metaDescription || "").replace(/"/g, "&quot;")}" />
  <link rel="canonical" href="${pageUrl}" />
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
    ${version?.contentHtml || "<p>Content coming soon.</p>"}

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
          const svcName = p.title.replace(/\s+in\s+.+$/i, "").replace(/\s*\|.*$/, "").trim();
          return `<a href="/${p.slug}">${svcName}</a>`;
        }).join("\n        ")}
      </div>
    </div>
  </div>` : ""}

  ${navData.cityPages.length > 0 ? `
  <div style="max-width:900px;margin:0 auto;padding:0 1.5rem">
    <div class="loc-nav">
      <div class="loc-nav-title">Cities in ${navData.stateDisplayName || "this state"}</div>
      <div class="loc-grid">
        ${navData.cityPages.map(p => `<a href="/${p.slug}">${p.displayName}</a>`).join("\n        ")}
      </div>
    </div>
  </div>` : ""}

  ${navData.statePages.length > 0 ? `
  <div style="max-width:900px;margin:0 auto;padding:0 1.5rem">
    <div class="loc-nav">
      <div class="loc-nav-title">Explore All Locations</div>
      <div class="loc-grid">
        ${navData.statePages.map(p => `<a href="/${p.slug}">${p.displayName}</a>`).join("\n        ")}
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

  app.put("/api/accounts/:id", requireAuth, async (req: Request, res: Response) => {
    const current = await storage.getAccount(req.params.id as string);
    if (!current) return res.status(404).json({ message: "Account not found" });
    const { name, slug, plan, status, settings } = req.body;
    const mergedSettings = { ...(current.settings as Record<string, any> ?? {}), ...(settings ?? {}) };
    const payload: Record<string, any> = { settings: mergedSettings };
    if (name !== undefined) payload.name = name;
    if (slug !== undefined) payload.slug = slug;
    if (plan !== undefined) payload.plan = plan;
    if (status !== undefined) payload.status = status;
    const updated = await storage.updateAccount(req.params.id as string, payload as any);
    return res.json(updated);
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

  // Convenience: get all locations for a website's account
  app.get("/api/websites/:id/locations", requireAuth, async (req: Request, res: Response) => {
    const website = await storage.getWebsite(req.params.id as string);
    if (!website) return res.status(404).json({ message: "Not found" });
    return res.json(await storage.getLocations(website.accountId));
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
    const pPath = (website.settings as any)?.proxyPath || "";
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
    const pPth = (website.settings as any)?.proxyPath || "";
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

    const [statePages, cityPages, stateDisplayName] = await resolveNavData(page, website.id);
    const html = renderPageHtml(page, version, website, brand, { statePages, cityPages, stateDisplayName });
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
      // Strip port from host header
      const host = (req.headers.host || "").split(":")[0].toLowerCase().trim();

      // Log every non-API, non-asset request to diagnose custom domain routing
      if (host && !PLATFORM_SUFFIXES.some(s => host.endsWith(s)) && host !== "localhost" && host !== "0.0.0.0" && !req.path.startsWith("/api/") && !req.path.startsWith("/src/") && !req.path.startsWith("/@") && !req.path.startsWith("/__")) {
        console.log(`[domain-mw] host=${host} path=${req.path}`);
      }

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
      if (!website) {
        console.log(`[domain-mw] no website found for host=${host}`);
        return next(); // unknown domain — fall through to admin app
      }

      const rawSlug = req.path.replace(/^\//, "").replace(/\/$/, "");

      // Sitemap — serve inline (Google does not follow redirects for sitemaps)
      if (rawSlug === "sitemap.xml" || rawSlug === "sitemap_index.xml" || rawSlug === "sitemap") {
        const sitemapList = await storage.getSitemapsMeta(website.id);
        const baseUrl = `https://${website.domain}`;
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
        const baseUrl = `https://${website.domain}`;
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
        const robotsContent = website.robotsTxt
          || generateRobotsTxt(website.domain, `https://${website.domain}/sitemap.xml`);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.send(robotsContent);
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
        console.log(`[page-serve] 404 ${host}/${rawSlug} — ${!page ? "not found" : "not published"}`);
        return res.status(404).send(notFoundHtml("Page not found or not yet published"));
      }

      const version = await storage.getActivePageVersion(page.id);
      const brandProfiles = await storage.getBrandProfiles(website.accountId);
      const brand = brandProfiles[0];
      const [statePages, cityPages, stateDisplayName, siblingServices] = await resolveNavData(page, website.id);
      const html = renderPageHtml(page, version, website, brand, { statePages, cityPages, stateDisplayName, siblingServices });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      console.log(`[page-serve] 200 ${host}/${rawSlug}`);
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

  // Active bank-write job status for a website (used by UI to restore progress bar on page refresh)
  app.get("/api/websites/:id/bank-write-job", requireAuth, async (req: Request, res: Response) => {
    const websiteId = req.params.id as string;
    const jobs = await storage.getGenerationJobs(websiteId);
    const active = jobs.find(j => {
      const s = j.settings as any;
      return s?.type === "bank_write" && (j.status === "running" || j.status === "pending");
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
      const interp = (t: string) => t
        .replace(/\{service[^}]*\}/gi, vars.service)
        .replace(/\{location[^}]*\}/gi, vars.location)
        .replace(/\{city[^}]*\}/gi, vars.location)
        .replace(/\{state[^}]*\}/gi, vars.state)
        .replace(/\{brand[^}]*\}/gi, vars.brand)
        .replace(/\{keyword[^}]*\}/gi, vars.service)
        .replace(/\{state_abbr[^}]*\}/gi, vars.stateAbbr)
        .replace(/\{abbr[^}]*\}/gi, vars.stateAbbr)
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
      overwrite: z.boolean().optional(),
    });
    const body = schema.parse(req.body);
    const websiteId = req.params.id as string;

    const website = await storage.getWebsite(websiteId);
    if (!website) return res.status(404).json({ error: "Website not found" });

    const progress = body.services.map(s => ({ service: s, status: "pending" as const, created: 0, updated: 0, skipped: 0, errors: 0 }));
    const jobSettings = { ...body, progress };

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
        storage.updateGenerationJob(job.id, { status: "error", completedAt: new Date() }).catch(() => {});
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

  return httpServer;
}
