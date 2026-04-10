/**
 * Hub Page HTML Generator (Phase 5)
 *
 * Builds the public-facing HTML for service, state, and city hub pages.
 * Hub pages are index/aggregator pages that link to the most-qualified
 * child pages ordered by quality_score DESC.
 */

export type HubType = "service" | "state" | "city";

export interface ChildLink {
  title: string;
  slug: string;
  qualityScore: number | null;
  tier: number | null;
}

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
}

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

export function renderHubPageHtml(opts: HubPageRenderOptions): string {
  const { hubType, name, slug, parentSlug, childLinks, website, brand } = opts;

  const brandName = brand?.name || website.settings?.brandName || website.domain;
  const primaryColor = brand?.primaryColor || "#2563eb";
  const phone = brand?.phone || website.settings?.phone || "";
  const mainWebsiteUrl = website.settings?.mainWebsiteUrl || brand?.customFields?.websiteUrl || "";
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
    <p class="intro">${intro}</p>

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
