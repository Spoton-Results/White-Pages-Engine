/**
 * Hub Page HTML Generator (Phase 5 → Phase 6)
 *
 * Builds the public-facing HTML for service, state, and city hub pages.
 * Hub pages are index/aggregator pages that link to the most-qualified
 * child pages ordered by quality_score DESC.
 *
 * Phase 6 upgrade: Hub pages now call generateFirstPass() from claude.ts
 * to produce real E-E-A-T content instead of static template intro text.
 * The child-link grid and all schema/meta markup are preserved unchanged.
 *
 * Usage:
 *   const generated = await generateHubContent(opts);          // calls Claude
 *   const scores    = scoreHubPage(generated, childLinks);     // hub-specific weights
 *   const html      = renderHubPageHtml({ ...opts,             // existing renderer
 *                       aiContentHtml: generated.contentHtml,
 *                       faqItems:      generated.faqItems });
 *
 * Feature flag: set ENABLE_HUB_AI=true in Railway env to activate.
 * Existing static render is preserved as the fallback.
 */

import { generateFirstPass, type PageContext, type GeneratedPage } from "./claude";

// ─── Existing Types (unchanged) ──────────────────────────────────────────────

export type HubType = "service" | "state" | "city";

export interface ChildLink {
  title: string;
  slug: string;
  qualityScore: number | null;
  tier: number | null;
}

/** Extended to accept optional AI-generated content from generateHubContent() */
export interface HubPageRenderOptions {
  hubType: HubType;
  name: string;
  slug: string;
  metaDescription?: string | null;
  parentSlug?: string | null;
  childLinks: ChildLink[];
  website: {
    domain: string;
    settings: Record<string, any>;
  };
  brand?: {
    name?: string;
    primaryColor?: string;
    phone?: string;
    tagline?: string;
    customFields?: Record<string, any>;
  } | null;
  /** Phase 6: inject AI-generated content above the child grid */
  aiContentHtml?: string;
  /** Phase 6: FAQ items from generateFirstPass() — rendered as accordion */
  faqItems?: Array<{ question: string; answer: string }>;
}

// ─── New: Hub Generation Options ─────────────────────────────────────────────

export interface HubGenerationOptions {
  hubType: HubType;
  name: string;
  slug: string;
  websiteId: number;
  childLinks: ChildLink[];
  brand: {
    name?: string;
    phone?: string;
    tagline?: string;
    description?: string;
    yearsInBusiness?: string | number;
    licenses?: string[];
    reviewSummary?: string;
    voiceAndTone?: string;
  } | null;
  industry?: string;
  /** e.g. "Texas" for a city hub, service name for a state hub */
  parentName?: string;
}

// ─── New: Hub Score ───────────────────────────────────────────────────────────

export interface HubScore {
  publishScore: number;
  localSignalScore: number;
  qualityScore: number;
  tier: number;
}

// ─── Existing Helpers (unchanged) ────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function titleCase(s: string) {
  return s.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function hubTypeLabel(t: HubType) {
  return t === "service" ? "Service" : t === "state" ? "State" : "City";
}

function hubHeading(hubType: HubType, name: string, brandName: string): string {
  if (hubType === "service") return `${name} Services — All Locations`;
  if (hubType === "state") return `${name} — ${brandName} Locations`;
  return `${name} — Available Services`;
}

function hubIntro(hubType: HubType, name: string, brandName: string, childCount: number): string {
  if (hubType === "service") {
    return `Browse all <strong>${childCount}</strong> locations where ${brandName} provides <strong>${esc(name)}</strong>. Each page covers local pricing, local reviews, and area-specific information to help you make the best decision.`;
  }
  if (hubType === "state") {
    return `Find ${brandName} services available across <strong>${esc(name)}</strong>. We've published detailed pages for <strong>${childCount}</strong> cities and service combinations in this state.`;
  }
  return `Explore all <strong>${childCount}</strong> services ${brandName} offers in <strong>${esc(name)}</strong>. Each link goes to a dedicated page with local pricing, FAQs, and contact options.`;
}

function gridSectionTitle(hubType: HubType): string {
  if (hubType === "service") return "Available Locations";
  if (hubType === "state") return "Cities & Services";
  return "Services in This City";
}

// ─── New: generateHubContent() ───────────────────────────────────────────────

/**
 * Builds a PageContext tailored for hub pages and calls generateFirstPass().
 *
 * Hub pages use EXPLORATORY intent — NOT the same narrow transactional prompt
 * as city/service pages. The PageContext is shaped per hub type:
 *   service hub → broad service overview + location comparison guidance
 *   state hub   → regional overview + state-specific considerations
 *   city hub    → local service overview + city context
 *
 * Child links are summarised into secondaryKeywords so Claude understands
 * the scope without copying child content verbatim.
 */
export async function generateHubContent(
  opts: HubGenerationOptions
): Promise<GeneratedPage> {
  const { hubType, name, slug, childLinks, brand, industry, parentName } = opts;

  const childCount = childLinks.length;
  const topChildren = childLinks.slice(0, 5).map(c => c.title).join(", ");

  // Per hub-type section plans — injected via PageContext.sections
  const sectionPlansByType: Record<HubType, Array<{ name: string; description: string }>> = {
    service: [
      { name: "Introduction",        description: `What "${name}" means, who needs it, and why it matters — write for someone exploring their options, not ready to buy yet` },
      { name: "Coverage Overview",   description: `How many locations this service is available in (${childCount} total) and what that geographic spread means for customers` },
      { name: "How to Choose a Location", description: "What factors matter when picking a city page — distance, local regulations, pricing variation, provider familiarity" },
      { name: "What to Expect",      description: "Real process details: what the service involves, typical timelines, what drives cost variation — insider knowledge only" },
      { name: "FAQ",                  description: `4 real questions people ask about ${name} across locations — answer each specifically, not generically` },
      { name: "Next Steps",           description: "Guide them to the right child page contextually — reference the top locations by name. No generic 'contact us'." },
    ],
    state: [
      { name: "Introduction",              description: `Why ${name} is an important market for this service and what makes it distinct as a region` },
      { name: "Regional Overview",         description: `Key cities and service combinations covered in ${name} (${childCount} pages total) — describe the spread, not a list` },
      { name: "State-Specific Considerations", description: `Local regulations, licensing requirements, or geographic factors in ${name} that affect this service` },
      { name: "How Services Are Structured", description: "What varies city-to-city vs what stays consistent across the state — help readers understand variability" },
      { name: "FAQ",                        description: `4 questions specific to getting this service in ${name} — state-level, not generic` },
      { name: "Find Your Location",         description: "Contextual guide to the child pages — reference top cities by name" },
    ],
    city: [
      { name: "Introduction",         description: `What makes ${name} a distinct service market — local context, industry mix, relevant demographics` },
      { name: "Services Available",   description: `Overview of what this business offers in ${name} — written from knowledge, covering the ${childCount} services available` },
      { name: "Local Context",        description: `Relevant details about ${name} that affect service delivery: neighborhoods, industries, infrastructure, local business environment` },
      { name: "How to Choose a Service", description: "Help the reader decide which service page to visit — describe each service area in one sentence" },
      { name: "FAQ",                   description: `4 questions local customers in ${name} actually ask — hyperlocal, not generic` },
      { name: "Get Started",           description: "Contextual CTA referencing specific services available in this city — not a generic form pitch" },
    ],
  };

  // Title/meta/h1 templates per hub type
  const titleTemplates: Record<HubType, string> = {
    service: `${name} Services — All Locations | {brand}`,
    state:   `${name} — {brand} Locations & Services`,
    city:    `${name} Services — {brand}`,
  };
  const metaTemplates: Record<HubType, string> = {
    service: `Find all ${childCount} locations offering ${name} from {brand}. Compare areas, read local info, and choose the right location for you.`,
    state:   `Explore {brand} services across ${name}. ${childCount} pages covering cities and services throughout the state.`,
    city:    `See all services {brand} offers in ${name}. ${childCount} service pages with local pricing, FAQs, and contact options.`,
  };
  const h1Templates: Record<HubType, string> = {
    service: `${name} Services — All Locations`,
    state:   `${name} — All Locations & Services`,
    city:    `${name} — All Available Services`,
  };

  const ctx: PageContext = {
    pageType:         `${hubType}_hub`,
    blueprintName:    `${titleCase(hubType)} Hub — ${name}`,
    promptFamily:     "hub",
    titleTemplate:    titleTemplates[hubType],
    metaDescTemplate: metaTemplates[hubType],
    h1Template:       h1Templates[hubType],
    slugTemplate:     slug,

    // Location / service context
    locationName:  hubType === "city"    ? name        : (parentName ?? undefined),
    locationState: hubType === "state"   ? name        : (parentName ?? undefined),
    serviceName:   hubType === "service" ? name        : undefined,
    industryName:  industry,

    // Content requirements
    requiredWordCount: 750,
    faqEnabled:        true,
    sections:          sectionPlansByType[hubType],

    // Brand signals
    brandName:            brand?.name,
    brandPhone:           brand?.phone,
    brandTagline:         brand?.tagline,
    brandDescription:     brand?.description,
    brandYearsInBusiness: brand?.yearsInBusiness,
    brandLicenses:        brand?.licenses,
    brandReviewSummary:   brand?.reviewSummary,
    brandVoiceAndTone:    brand?.voiceAndTone
      ?? "Knowledgeable and direct. Write like a local expert helping someone navigate options — not a directory listing.",

    // Hub keyword signals — shape Claude toward exploratory intent
    primaryKeyword: hubType === "service"
      ? `${name} services`
      : hubType === "state"
      ? `${name} ${industry ?? "services"}`
      : `${name} local services`,
    secondaryKeywords: [
      `${name} options`,
      `${name} ${hubType === "city" ? "service providers" : "locations"}`,
      `best ${name} ${hubType === "service" ? "areas" : "services"}`,
      topChildren,
    ].filter(Boolean),

    // No bank snippets for hubs — they are pillar pages, not local variants
    bankSnippets: [],
  };

  return generateFirstPass(ctx);
}

// ─── New: scoreHubPage() ─────────────────────────────────────────────────────

/**
 * Score hub pages with hub-specific weights.
 *
 * DO NOT reuse bulk-page scoring — hub success metrics differ.
 * Hubs are judged on topical depth AND navigational usefulness.
 *
 * Weights:
 *   AI publish score (E-E-A-T)     35%
 *   AI local signal score          20%
 *   Child link coverage            25%   (scaled: 20 children = full marks)
 *   Word count adequacy            20%   (750 floor, 1000+ = full)
 *
 * Tier logic requires BOTH quality score AND minimum child count
 * to prevent "tier inflation" where architecture value masks weak content.
 */
export function scoreHubPage(
  generated: GeneratedPage,
  childLinks: ChildLink[]
): HubScore {
  const aiPublish  = generated.publishScore     ?? 0.5;
  const aiLocal    = generated.localSignalScore ?? 0.5;

  // Child coverage: scaled at 20 = full marks
  const childCoverage = Math.min(1, childLinks.length / 20);

  // Word count adequacy
  const wordScore = generated.wordCount >= 1000 ? 1
    : generated.wordCount >= 750  ? 0.8
    : generated.wordCount >= 500  ? 0.5
    : 0.2;

  const raw = (aiPublish * 0.35) + (aiLocal * 0.20) + (childCoverage * 0.25) + (wordScore * 0.20);
  const qualityScore = Math.round(Math.min(100, raw * 100));

  // Tier: requires both quality AND child link minimum
  let tier = 3;
  if (qualityScore >= 80 && childLinks.length >= 5)  tier = 1;
  else if (qualityScore >= 60 && childLinks.length >= 2) tier = 2;

  return {
    publishScore:     aiPublish,
    localSignalScore: aiLocal,
    qualityScore,
    tier,
  };
}

// ─── Existing: renderHubPageHtml() (extended, backward-compatible) ────────────

export function renderHubPageHtml(opts: HubPageRenderOptions): string {
  const { hubType, name, slug, parentSlug, childLinks, website, brand } = opts;

  const brandName = brand?.name || website.settings?.brandName || website.domain;
  const primaryColor = brand?.primaryColor || "#2563eb";
  const phone = brand?.phone || website.settings?.phone || "";
  const rawMainUrl = website.settings?.mainWebsiteUrl || brand?.customFields?.websiteUrl || "";
  const mainWebsiteUrl = rawMainUrl && !/^https?:\/\//i.test(rawMainUrl) ? `https://${rawMainUrl}` : rawMainUrl;
  const parentDomain = website.settings?.parentDomain;
  const rawProxyPath = (website.settings?.proxyPath || "") as string;
  // Sanitize: admin-preview paths (starting with /sites/) must never be used in live page content
  const proxyPath = rawProxyPath.startsWith("/sites/") ? "" : rawProxyPath;
  const canonicalBase = parentDomain ? `https://${parentDomain}${proxyPath}` : `https://${website.domain}`;
  const pageUrl = `${canonicalBase}/${slug}`;
  const baseUrl = canonicalBase;

  const title = `${name} | ${brandName}`;
  const metaDesc = opts.metaDescription || `${hubTypeLabel(hubType)} hub — ${childLinks.length} pages available.`;
  const heading = hubHeading(hubType, name, brandName);
  // Static intro used only when aiContentHtml is NOT provided (backward compat)
  const intro = hubIntro(hubType, name, brandName, childLinks.length);

  // GA snippet pass-through
  const gaSpotOn = website.domain === "pages.spotonresults.com"
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=G-VH980NTHCM"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-VH980NTHCM');</script>`
    : "";
  const gaSubtracker = website.domain === "pagessubtrackers.spotonresults.com"
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=G-GY5VTKVQ88"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-GY5VTKVQ88');</script>`
    : "";

  // BreadcrumbList schema
  const breadcrumbSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", position: 1, name: "Home", item: baseUrl },
      { "@type": "ListItem", position: 2, name: name, item: pageUrl },
    ],
  });

  // CollectionPage schema
  const collectionSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": title,
    "description": metaDesc,
    "url": pageUrl,
    "hasPart": childLinks.slice(0, 10).map(l => ({
      "@type": "WebPage",
      "name": l.title,
      "url": `${canonicalBase}/${l.slug}`,
    })),
  });

  const childGrid = childLinks.length === 0
    ? `<p style="color:#6b7280">No pages published yet for this hub.</p>`
    : childLinks.map(l => {
        const tierBadge = l.tier === 1 ? `<span style="background:#dcfce7;color:#16a34a;font-size:.65rem;font-weight:700;padding:1px 5px;border-radius:4px;margin-left:4px">T1</span>` : "";
        return `<a href="${esc(canonicalBase)}/${esc(l.slug)}" style="display:block;padding:.55rem .75rem;background:#fff;border:1px solid #e5e7eb;border-radius:.5rem;font-size:.875rem;color:#1d4ed8;text-decoration:none;transition:all .15s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onmouseover="this.style.background='${primaryColor}10';this.style.borderColor='${primaryColor}40'" onmouseout="this.style.background='#fff';this.style.borderColor='#e5e7eb'">${esc(l.title)}${tierBadge}</a>`;
      }).join("\n        ");

  const parentBacklink = parentSlug
    ? `<p style="margin-top:1.5rem;font-size:.875rem"><a href="${esc(canonicalBase)}/${esc(parentSlug)}" style="color:${primaryColor}">← Back to ${esc(titleCase(parentSlug.replace(/-/g, " ")))}</a></p>`
    : "";

  // Phase 6: AI content block (replaces static intro when present)
  const aiBlock = opts.aiContentHtml
    ? `<div class="hub-ai-content">${opts.aiContentHtml}</div>`
    : `<p class="intro">${intro}</p>`;

  // Phase 6: FAQ accordion (rendered only when faqItems provided)
  const faqBlock = opts.faqItems?.length
    ? `<section class="hub-faq">
    <h2 class="section-title">Frequently Asked Questions</h2>
    ${opts.faqItems.map(f => `<details class="faq-item">
      <summary class="faq-q">${esc(f.question)}</summary>
      <div class="faq-a"><p>${esc(f.answer)}</p></div>
    </details>`).join("\n    ")}
  </section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(metaDesc)}"/>
  <link rel="canonical" href="${esc(pageUrl)}"/>
  <meta name="robots" content="index,follow"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(metaDesc)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${esc(pageUrl)}"/>
  <meta property="og:site_name" content="${esc(brandName)}"/>
  <script type="application/ld+json">${breadcrumbSchema}</script>
  <script type="application/ld+json">${collectionSchema}</script>
  ${gaSpotOn}${gaSubtracker}
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2937;line-height:1.6}
    a{color:${primaryColor};text-decoration:none}a:hover{text-decoration:underline}
    header{background:${primaryColor};color:#fff;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem}
    header .brand{font-size:1.25rem;font-weight:700;color:#fff;text-decoration:none}
    header .phone{font-size:1rem;font-weight:600;color:#fff;opacity:.9}
    .hero{background:${primaryColor}10;border-bottom:1px solid ${primaryColor}20;padding:2.5rem 2rem}
    .hero h1{font-size:1.75rem;font-weight:800;color:#111827;max-width:800px;line-height:1.2}
    .badge{display:inline-block;background:${primaryColor}18;color:${primaryColor};font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:12px;margin-bottom:.75rem;letter-spacing:.04em;text-transform:uppercase}
    main{max-width:960px;margin:2rem auto;padding:0 1.5rem}
    .intro{color:#374151;font-size:1rem;margin-bottom:2rem;max-width:700px}
    .section-title{font-size:1.1rem;font-weight:700;color:#111827;margin-bottom:1rem;padding-bottom:.5rem;border-bottom:2px solid ${primaryColor}20}
    .child-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.5rem;margin-bottom:2rem}
    @media(max-width:640px){.child-grid{grid-template-columns:1fr 1fr}}
    @media(max-width:400px){.child-grid{grid-template-columns:1fr}}
    .count-chip{display:inline-block;background:#f3f4f6;color:#6b7280;font-size:.78rem;font-weight:600;padding:2px 8px;border-radius:6px;margin-left:.5rem;vertical-align:middle}
    footer{background:#f9fafb;border-top:1px solid #e5e7eb;padding:1.5rem 2rem;text-align:center;color:#9ca3af;font-size:.85rem;margin-top:3rem}
    /* Phase 6: AI content styles */
    .hub-ai-content{color:#374151;font-size:1rem;margin-bottom:2rem}
    .hub-ai-content h2{font-size:1.25rem;font-weight:700;color:#111827;margin:1.5rem 0 .75rem;padding-bottom:.4rem;border-bottom:1px solid ${primaryColor}18}
    .hub-ai-content h3{font-size:1.05rem;font-weight:600;color:#1f2937;margin:1.25rem 0 .5rem}
    .hub-ai-content p{margin-bottom:1rem;max-width:72ch}
    .hub-ai-content ul,.hub-ai-content ol{margin:.5rem 0 1rem 1.5rem}
    .hub-ai-content li{margin-bottom:.35rem}
    /* Phase 6: FAQ accordion styles */
    .hub-faq{margin:2rem 0}
    .faq-item{border:1px solid #e5e7eb;border-radius:.5rem;margin-bottom:.5rem;overflow:hidden}
    .faq-q{padding:.75rem 1rem;font-weight:600;font-size:.95rem;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;background:#f9fafb}
    .faq-q::-webkit-details-marker{display:none}
    .faq-q::after{content:"＋";font-size:.85rem;color:${primaryColor};flex-shrink:0}
    details[open] .faq-q::after{content:"－"}
    .faq-a{padding:.75rem 1rem 1rem;border-top:1px solid #e5e7eb}
    .faq-a p{margin:0;color:#374151;font-size:.9rem}
  </style>
</head>
<body>
  <header>
    ${mainWebsiteUrl
      ? `<a href="${esc(mainWebsiteUrl)}" class="brand" target="_blank" rel="noopener">${esc(brandName)}</a>`
      : `<span class="brand">${esc(brandName)}</span>`}
    ${phone ? `<a href="tel:${phone.replace(/\D/g, "")}" class="phone">${esc(phone)}</a>` : ""}
  </header>

  <div class="hero">
    <div class="badge">${esc(hubTypeLabel(hubType))} Hub</div>
    <h1>${esc(heading)}</h1>
  </div>

  <main>
    ${aiBlock}

    ${faqBlock}

    <h2 class="section-title">
      ${esc(gridSectionTitle(hubType))}
      <span class="count-chip">${childLinks.length}</span>
    </h2>
    <div class="child-grid">
      ${childGrid}
    </div>

    ${parentBacklink}
  </main>

  <footer>
    &copy; ${new Date().getFullYear()} ${esc(brandName)}. All rights reserved.
    ${mainWebsiteUrl ? ` · <a href="${esc(mainWebsiteUrl)}" style="color:#9ca3af">${esc(brandName)} Website</a>` : ""}
  </footer>
</body>
</html>`;
}
