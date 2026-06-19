import type { ContentVariationBank, StateData } from "@shared/schema";
import { getDisplayLocation, sanitizeGeoText, sanitizeSlug } from "./geo-guardrails";

export interface VariationPageResult {
  contentHtml: string;
  title: string;
  h1: string;
  metaDescription: string;
  slug: string;
  wordCount: number;
}

// ✅ CHANGED: new interface for brand/CTA/demo overrides passed from bulk job settings
export interface BrandContext {
  websiteUrl?: string;
  phoneOverride?: string;
  ctaHeading?: string;
  ctaBody?: string;
  ctaButtonLabel?: string;
  demoBannerUrl?: string;
  demoBannerHeading?: string;
  demoBannerSubtext?: string;
  demoBannerButton?: string;
  // CHANGED: optional brand media for generated page image blocks
  brandMedia?: Array<{
    publicUrl?: string;
    r2Key?: string;
    altText?: string;
    category?: string;
    sortOrder?: number;
  }>;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// ✅ CHANGED: keep state-data facts from being injected as full sentence fragments inside normal prose.
// 🔒 UNTOUCHED: actual page sections, section order, bank selection, slugs, images, and scoring remain unchanged.
function safePhrase(value: unknown, fallback: string): string {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/[.;:]/.test(text) || text.split(/\s+/).length > 7) return fallback;
  return text;
}

function cleanGeneratedText(html: string, brandName: string): string {
  return html
    // ✅ CHANGED: repair bank templates that start sentences with an unresolved brand/company placeholder.
    .replace(/(<p>\s*)(recognizes|adjusts|transitions|tailors|ensures|helps|provides)\b/gi, `$1${brandName} $2`)
    .replace(/(<p>\s*Yes\.\s*)(ensures|helps|provides|recognizes|adjusts|tailors)\b/gi, `$1${brandName} $2`)
    // ✅ CHANGED: repair known CTA typo caused by pasted brand/demo text.
    .replace(/\bTGet a high-converting websiteoday\b/g, "Get a high-converting website today");
}

function buildFaqJsonLd(faqHtml: string): string {
  const entities: Array<{ "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }> = [];
  const regex = /<p><strong>Q:\s*(.*?)<\/strong><\/p>\s*<p>(.*?)<\/p>/gis;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(faqHtml)) !== null) {
    const question = m[1].replace(/<[^>]+>/g, "").trim();
    const answer = m[2].replace(/<[^>]+>/g, "").trim();
    if (question && answer) entities.push({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } });
  }
  if (!entities.length) return "";
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: entities })}</script>`;
}

function buildBreadcrumbJsonLd(domain: string, serviceName: string, serviceSlug: string, locationName: string, locationType: string, stateName: string, stateAbbr: string): string {
  const base = domain ? `https://${domain}` : "";
  const statePageSlug = sanitizeSlug(`${serviceSlug}-in-${slugify(stateName)}`);
  const displayLocation = getDisplayLocation({ locationName, locationType, stateName, stateAbbr });
  const items = locationType === "state"
    ? [{ "@type": "ListItem", position: 1, name: "Home", item: `${base}/` }, { "@type": "ListItem", position: 2, name: `${serviceName} in ${stateName}` }]
    : [{ "@type": "ListItem", position: 1, name: "Home", item: `${base}/` }, { "@type": "ListItem", position: 2, name: `${serviceName} in ${stateName}`, item: `${base}/${statePageSlug}` }, { "@type": "ListItem", position: 3, name: `${serviceName} in ${displayLocation}` }];
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items })}</script>`;
}

function buildLocalBusinessJsonLd(brandName: string, serviceName: string, locationName: string, stateName: string, stateAbbr: string, locationType: string): string {
  if (locationType !== "city") return "";
  const displayLocation = getDisplayLocation({ locationName, locationType, stateName, stateAbbr });
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: brandName,
    description: `${serviceName} services for businesses in ${displayLocation}`,
    areaServed: { "@type": "City", name: locationName, containedInPlace: { "@type": "State", name: stateName } },
    serviceType: serviceName,
    address: { "@type": "PostalAddress", addressLocality: locationName, addressRegion: stateAbbr, addressCountry: "US" },
  })}</script>`;
}

export interface ClusterContext {
  id: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  intentType: string;
}

export function buildVariationPage(
  serviceName: string,
  serviceSlug: string,
  locationName: string,
  locationType: string,
  stateName: string,
  stateAbbr: string,
  brandName: string,
  banks: ContentVariationBank[],
  state: StateData | undefined,
  cluster?: ClusterContext | null,
  citiesInState?: Array<{ name: string }>,
  relatedServices?: Array<{ name: string; slug: string }>,
  websiteDomain?: string,
  blueprintSlugTemplate?: string,
  proxyPath?: string,
  brandContext?: BrandContext, // ✅ CHANGED: optional brand/CTA/demo override context
): VariationPageResult {
  const linkPrefix = proxyPath || "";
  const landmark = state ? pick(state.landmarks as string[]) : stateName;
  const city = locationType === "state" ? stateName : locationName;
  const stateDisplay = stateName;
  const geoTarget = { locationName, locationType, stateName, stateAbbr };
  const displayLocation = getDisplayLocation(geoTarget);

  const safeBusinessCulture = safePhrase(state?.businessCulture, `${stateName} business conditions`);
  const safePaymentRegulations = safePhrase(state?.paymentRegulations, "payment and compliance considerations");
  const safePopulation = state?.population && Number(state.population) < 1000000 ? state.population.toLocaleString() : "local";
  const safeBusinessCount = state?.businessCount && Number(state.businessCount) < 100000 ? state.businessCount.toLocaleString() : "many";

  const vars: Record<string, string> = {
    service: serviceName,
    city,
    location: displayLocation,
    state: stateDisplay,
    state_abbr: stateAbbr,
    landmark,
    // ✅ CHANGED: use safe phrases so full state facts do not leak into unrelated sentences.
    business_culture: safeBusinessCulture,
    payment_regulations: safePaymentRegulations,
    population: safePopulation,
    business_count: safeBusinessCount,
    brand: brandName,
    // ✅ CHANGED: alias common bank placeholders to brand instead of blanking them out.
    company: brandName,
    company_name: brandName,
    business: brandName,
    business_name: brandName,
    provider: brandName,
    agency: brandName,
    primary_keyword: cluster?.primaryKeyword ?? serviceName,
    secondary_keywords: cluster?.secondaryKeywords?.join(", ") ?? "",
    intent_type: cluster?.intentType ?? "",
  };

  const getSection = (name: string): string => {
    const bank = banks.find(b => b.sectionName === name);
    if (!bank) return "";
    const variations = bank.variations as string[];
    if (!variations.length) return "";
    return cleanGeneratedText(sanitizeGeoText(substitute(pick(variations), vars), geoTarget), brandName);
  };

  const intro = getSection("intro");
  const localContext = getSection("local_context");
  const painPoint = getSection("pain_point");
  const howItWorks = getSection("how_it_works");
  const benefits = getSection("benefits");
  const useCase = getSection("use_case");
  const proofTrust = getSection("proof_trust");
  const localStat = getSection("local_stat");
  const comparison = getSection("comparison");
  const pricingFactors = getSection("pricing_factors");
  const bestFit = getSection("best_fit");
  const softwareIntegration = getSection("software_integration");
  const faq = getSection("faq");
  const cta = getSection("cta");

  const h2Style = `style="font-size:1.35rem;font-weight:700;color:#111827;margin:2rem 0 .75rem;padding-bottom:.5rem;border-bottom:2px solid #2563eb20"`;
  const section = (heading: string, body: string) => body ? `<h2 ${h2Style}>${sanitizeGeoText(heading, geoTarget)}</h2>\n${body}` : "";

  // ✅ CHANGED: deterministically choose intro image by category.
  // 🔒 UNTOUCHED: image rendering position, markup, R2 URL format, and page structure.
  const activeBrandMedia = (brandContext?.brandMedia || [])
    .filter((media) => (media.publicUrl || media.r2Key) && (media.active ?? true))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  const selectBrandMediaByCategory = (category: string) =>
    activeBrandMedia.find((media) => media.category === category);

  const usedBrandMediaIds = new Set<string>();

  const getBrandMediaUrl = (media: any) =>
    media?.publicUrl && /^https?:\/\//i.test(media.publicUrl)
      ? media.publicUrl
      : media?.r2Key
        ? `https://pub-1e7626f01f4a4399915b608da09ccc25.r2.dev/${media.r2Key}`
        : "";

  const selectBrandMediaForSlot = (category: string) => {
    const candidates = [
      selectBrandMediaByCategory(category),
      selectBrandMediaByCategory("business_general"),
      ...activeBrandMedia,
    ].filter(Boolean);

    return candidates.find((media: any) => !usedBrandMediaIds.has(media.id)) || candidates[0];
  };

  const renderBrandImageBlock = (category: string, fallbackAlt: string) => {
    const media: any = selectBrandMediaForSlot(category);
    const imageUrl = getBrandMediaUrl(media);
    if (!media || !imageUrl) return "";

    if (media.id) usedBrandMediaIds.add(media.id);

    return `<figure style="margin:1.75rem 0 2rem;border-radius:.9rem;overflow:hidden;border:1px solid #e5e7eb;background:#f9fafb">` +
      `<img src="${imageUrl}" alt="${media.altText || fallbackAlt}" loading="lazy" style="display:block;width:100%;height:auto;max-height:420px;object-fit:cover" />` +
      `</figure>`;
  };

  // ✅ CHANGED: multiple deterministic brand image placements.
  // 🔒 UNTOUCHED: section order, section copy, R2 URL format, and page rendering pipeline.
  const heroImageBlock = renderBrandImageBlock("hero", `${brandName} ${serviceName}`);
  const serviceImageBlock = renderBrandImageBlock("service", `${serviceName} service image`);
  const teamImageBlock = renderBrandImageBlock("team", `${brandName} team image`);
  const locationImageBlock = renderBrandImageBlock("location", `${serviceName} in ${displayLocation}`);

  // ✅ CHANGED: demo banner rendered at top of every page when demoBannerUrl is provided; empty string = hidden
  const demoBanner = brandContext?.demoBannerUrl
    ? `<div style="background:#1e40af;color:#fff;padding:.75rem 1.5rem;border-radius:.5rem;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem">` +
      `<span><strong>${cleanGeneratedText(brandContext.demoBannerHeading || "", brandName)}</strong>${brandContext.demoBannerSubtext ? ` — ${cleanGeneratedText(brandContext.demoBannerSubtext, brandName)}` : ""}</span>` +
      `<a href="${brandContext.demoBannerUrl}" style="background:#fff;color:#1e40af;font-weight:700;padding:.4rem 1.25rem;border-radius:.4rem;text-decoration:none;white-space:nowrap">${brandContext.demoBannerButton || "Learn More"}</a>` +
      `</div>`
    : "";

  let citiesSection = "";
  if (locationType === "state" && citiesInState && citiesInState.length > 0) {
    const items = citiesInState.map(c => {
      const citySlug = sanitizeSlug(`${serviceSlug}-in-${slugify(c.name)}-${stateAbbr.toLowerCase()}`);
      return `<li style="break-inside:avoid"><a href="${linkPrefix}/${citySlug}" style="color:#2563eb;text-decoration:none">${c.name}, ${stateAbbr}</a></li>`;
    }).join("\n");
    citiesSection = `<h2 ${h2Style}>Cities We Serve in ${stateName}</h2>\n<ul style="columns:3;column-gap:2rem;list-style:disc;padding-left:1.5rem;line-height:2.2;margin:0">\n${items}\n</ul>`;
  }

  let relatedServicesSection = "";
  if (locationType === "city" && relatedServices && relatedServices.length > 0) {
    const others = relatedServices.filter(s => s.slug !== serviceSlug);
    if (others.length > 0) {
      const bpUsesFullState = blueprintSlugTemplate ? /\{state\}/.test(blueprintSlugTemplate) && !/\{state_abbr\}/.test(blueprintSlugTemplate) : false;
      const statePart = bpUsesFullState ? slugify(stateName) : stateAbbr.toLowerCase();
      const locationSlug = sanitizeSlug(`${slugify(city)}-${statePart}`);
      const items = others.slice(0, 30).map(s => {
        const pageSlug = sanitizeSlug(`${s.slug}-in-${locationSlug}`);
        return `<li style="break-inside:avoid;margin-bottom:.35rem"><a href="${linkPrefix}/${pageSlug}" style="color:#2563eb;text-decoration:none;font-size:.95rem">${s.name}</a></li>`;
      }).join("\n");
      relatedServicesSection = `<h2 ${h2Style}>Related Services in ${displayLocation}</h2>\n<ul style="column-count:2;column-gap:2rem;list-style:disc;padding-left:1.5rem;line-height:1.8;margin:0">\n${items}\n</ul>`;
    }
  }

  const faqJsonLd = faq ? buildFaqJsonLd(faq) : "";
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(websiteDomain ?? "", serviceName, serviceSlug, locationName, locationType, stateName, stateAbbr);
  const localBusinessJsonLd = buildLocalBusinessJsonLd(brandName, serviceName, locationName, stateName, stateAbbr, locationType);

  // ✅ CHANGED: CTA block now uses brandContext overrides (ctaHeading, ctaBody, ctaButtonLabel, websiteUrl)
  // with full fallback to existing hardcoded defaults so pages without brandContext are unaffected
  const ctaHeading = cleanGeneratedText(brandContext?.ctaHeading || "Ready to Get Started?", brandName);
  const ctaBody = cleanGeneratedText(brandContext?.ctaBody || cta || "", brandName);
  const ctaButtonLabel = cleanGeneratedText(brandContext?.ctaButtonLabel || "", brandName);
  const ctaUrl = brandContext?.websiteUrl || "#";
  const ctaBlock = ctaBody || ctaHeading !== "Ready to Get Started?"
    ? `<div style="background:#2563eb;color:#fff;border-radius:.75rem;padding:2rem;margin:2.5rem 0;text-align:center">\n` +
      `<h2 style="color:#fff;font-size:1.35rem;font-weight:700;border:none;margin:.5rem 0">${ctaHeading}</h2>\n` +
      (ctaBody ? `<div style="color:#fff;margin:.5rem 0">${ctaBody}</div>\n` : "") +
      (ctaButtonLabel ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:1rem;background:#fff;color:#2563eb;font-weight:700;padding:.65rem 1.75rem;border-radius:.5rem;text-decoration:none">${ctaButtonLabel}</a>\n` : "") +
      `</div>`
    : "";

  const contentHtml = [
    demoBanner, // ✅ CHANGED: demo banner at top; empty string when not configured
    intro,
    heroImageBlock, // ✅ CHANGED: hero/category image after intro
    section(`${serviceName} Market Context in ${displayLocation}`, localContext),
    section(`Common ${serviceName} Problems in ${displayLocation}`, painPoint),
    section(`How ${serviceName} Works in ${displayLocation}`, howItWorks),
    serviceImageBlock, // ✅ CHANGED: service/category image after how-it-works
    section(`Why ${displayLocation} Businesses Choose ${brandName}`, benefits),
    section(`${serviceName} Use Cases in ${displayLocation}`, useCase),
    section(`Trust and Service Confidence`, proofTrust),
    teamImageBlock, // ✅ CHANGED: team/category image after trust section
    section(`${displayLocation} Market Signals`, localStat),
    locationImageBlock, // ✅ CHANGED: location/category image after market signals
    section(`${serviceName} Compared With Other Options`, comparison),
    section(`${serviceName} Cost and Pricing Factors`, pricingFactors),
    section(`Who Is the Best Fit for ${serviceName}?`, bestFit),
    section(`Software and Integration Considerations`, softwareIntegration),
    section("Frequently Asked Questions", faq),
    ctaBlock, // ✅ CHANGED: replaced hardcoded CTA with brandContext-aware ctaBlock
    citiesSection,
    relatedServicesSection,
    faqJsonLd,
    breadcrumbJsonLd,
    localBusinessJsonLd,
  ].filter(Boolean).join("\n");

  const finalContentHtml = cleanGeneratedText(sanitizeGeoText(contentHtml, geoTarget), brandName);
  const wordCount = finalContentHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const clusterSlug = cluster?.primaryKeyword ? slugify(cluster.primaryKeyword) : null;
  const locationSlug = locationType === "state" ? slugify(stateName) : sanitizeSlug(`${slugify(locationName)}-${stateAbbr.toLowerCase()}`);
  const slug = sanitizeSlug(clusterSlug ? `${serviceSlug}--${clusterSlug}--in-${locationSlug}` : `${serviceSlug}-in-${locationSlug}`);

  const clusterLabel = cluster?.primaryKeyword && cluster.primaryKeyword.toLowerCase() !== serviceName.toLowerCase() ? cluster.primaryKeyword : null;
  const title = locationType === "state" ? `${serviceName}${clusterLabel ? ` – ${clusterLabel}` : ""} in ${stateName} | ${brandName}` : `${serviceName}${clusterLabel ? ` – ${clusterLabel}` : ""} in ${displayLocation} | ${brandName}`;
  const h1 = locationType === "state" ? `${serviceName}${clusterLabel ? ` – ${clusterLabel}` : ""} in ${stateName}` : `${serviceName}${clusterLabel ? ` – ${clusterLabel}` : ""} in ${displayLocation}`;
  const targetKeyword = cluster?.primaryKeyword ?? serviceName;
  const metaDescription = locationType === "city"
    ? `Looking for ${targetKeyword} near ${displayLocation}? ${brandName} provides trusted ${serviceName} to local businesses. Serving the ${locationName} area — get a free quote today.`
    : `Looking for ${targetKeyword} in ${stateName}? ${brandName} delivers reliable ${serviceName} solutions to businesses across ${stateDisplay}. Get a free quote today.`;

  return {
    contentHtml: finalContentHtml,
    title: sanitizeGeoText(title, geoTarget),
    h1: sanitizeGeoText(h1, geoTarget),
    metaDescription: sanitizeGeoText(metaDescription, geoTarget),
    slug,
    wordCount,
  };
}
