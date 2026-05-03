import type { ContentVariationBank, StateData } from "@shared/schema";
import { getDisplayLocation, sanitizeGeoText } from "./geo-guardrails";

export interface VariationPageResult {
  contentHtml: string;
  title: string;
  h1: string;
  metaDescription: string;
  slug: string;
  wordCount: number;
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

// ── Structured data builders ─────────────────────────────────────────────────

function buildFaqJsonLd(faqHtml: string): string {
  const entities: Array<{ "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }> = [];
  const regex = /<p><strong>Q:\s*(.*?)<\/strong><\/p>\s*<p>(.*?)<\/p>/gis;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(faqHtml)) !== null) {
    const question = m[1].replace(/<[^>]+>/g, "").trim();
    const answer = m[2].replace(/<[^>]+>/g, "").trim();
    if (question && answer) {
      entities.push({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } });
    }
  }
  if (!entities.length) return "";
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entities,
  })}</script>`;
}

function buildBreadcrumbJsonLd(
  domain: string,
  serviceName: string,
  serviceSlug: string,
  locationName: string,
  locationType: string,
  stateName: string,
  stateAbbr: string,
): string {
  const base = domain ? `https://${domain}` : "";
  const statePageSlug = `${serviceSlug}-in-${slugify(stateName)}`;
  const displayLocation = getDisplayLocation({ locationName, locationType, stateName, stateAbbr });

  const items =
    locationType === "state"
      ? [
          { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
          { "@type": "ListItem", position: 2, name: `${serviceName} in ${stateName}` },
        ]
      : [
          { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
          { "@type": "ListItem", position: 2, name: `${serviceName} in ${stateName}`, item: `${base}/${statePageSlug}` },
          { "@type": "ListItem", position: 3, name: `${serviceName} in ${displayLocation}` },
        ];

  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  })}</script>`;
}

function buildLocalBusinessJsonLd(
  brandName: string,
  serviceName: string,
  locationName: string,
  stateName: string,
  stateAbbr: string,
  locationType: string,
): string {
  if (locationType !== "city") return "";
  const displayLocation = getDisplayLocation({ locationName, locationType, stateName, stateAbbr });
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: brandName,
    description: `${serviceName} services for businesses in ${displayLocation}`,
    areaServed: { "@type": "City", name: locationName, containedInPlace: { "@type": "State", name: stateName } },
    serviceType: serviceName,
    address: {
      "@type": "PostalAddress",
      addressLocality: locationName,
      addressRegion: stateAbbr,
      addressCountry: "US",
    },
  })}</script>`;
}

// ── Exports ──────────────────────────────────────────────────────────────────

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
): VariationPageResult {
  const linkPrefix = proxyPath || "";
  const landmark = state ? pick(state.landmarks as string[]) : stateName;
  const city = locationType === "state" ? stateName : locationName;
  const stateDisplay = stateName;
  const geoTarget = { locationName, locationType, stateName, stateAbbr };
  const displayLocation = getDisplayLocation(geoTarget);

  const vars: Record<string, string> = {
    service: serviceName,
    city,
    location: displayLocation,
    state: stateDisplay,
    state_abbr: stateAbbr,
    landmark,
    business_culture: state?.businessCulture ?? "",
    payment_regulations: state?.paymentRegulations ?? "",
    population: state?.population?.toLocaleString() ?? "",
    business_count: state?.businessCount?.toLocaleString() ?? "",
    brand: brandName,
    primary_keyword: cluster?.primaryKeyword ?? serviceName,
    secondary_keywords: cluster?.secondaryKeywords?.join(", ") ?? "",
    intent_type: cluster?.intentType ?? "",
  };

  const getSection = (name: string): string => {
    const bank = banks.find(b => b.sectionName === name);
    if (!bank) return "";
    const variations = bank.variations as string[];
    if (!variations.length) return "";
    return sanitizeGeoText(substitute(pick(variations), vars), geoTarget);
  };

  const intro = getSection("intro");
  const howItWorks = getSection("how_it_works");
  const benefits = getSection("benefits");
  const faq = getSection("faq");
  const cta = getSection("cta");

  const h2Style = `style="font-size:1.35rem;font-weight:700;color:#111827;margin:2rem 0 .75rem;padding-bottom:.5rem;border-bottom:2px solid #2563eb20"`;

  const section = (heading: string, body: string) =>
    body ? `<h2 ${h2Style}>${sanitizeGeoText(heading, geoTarget)}</h2>\n${body}` : "";

  // ── State hub → city pages (downward links) ──────────────────────────────
  let citiesSection = "";
  if (locationType === "state" && citiesInState && citiesInState.length > 0) {
    const items = citiesInState
      .map(c => {
        const citySlug = `${serviceSlug}-in-${slugify(c.name)}-${stateAbbr.toLowerCase()}`;
        return `<li style="break-inside:avoid"><a href="${linkPrefix}/${citySlug}" style="color:#2563eb;text-decoration:none">${c.name}, ${stateAbbr}</a></li>`;
      })
      .join("\n");
    citiesSection = `<h2 ${h2Style}>Cities We Serve in ${stateName}</h2>\n<ul style="columns:3;column-gap:2rem;list-style:disc;padding-left:1.5rem;line-height:2.2;margin:0">\n${items}\n</ul>`;
  }

  // ── City pages → sibling services (cross-service mesh links) ────────────
  let relatedServicesSection = "";
  if (locationType === "city" && relatedServices && relatedServices.length > 0) {
    const others = relatedServices.filter(s => s.slug !== serviceSlug);
    if (others.length > 0) {
      const bpUsesFullState = blueprintSlugTemplate
        ? /\{state\}/.test(blueprintSlugTemplate) && !/\{state_abbr\}/.test(blueprintSlugTemplate)
        : false;
      const statePart = bpUsesFullState ? slugify(stateName) : stateAbbr.toLowerCase();
      const locationSlug = `${slugify(city)}-${statePart}`;
      const items = others
        .slice(0, 30)
        .map(s => {
          const pageSlug = `${s.slug}-in-${locationSlug}`;
          return `<li style="break-inside:avoid;margin-bottom:.35rem"><a href="${linkPrefix}/${pageSlug}" style="color:#2563eb;text-decoration:none;font-size:.95rem">${s.name}</a></li>`;
        })
        .join("\n");
      relatedServicesSection = `<h2 ${h2Style}>Related Services in ${displayLocation}</h2>\n<ul style="column-count:2;column-gap:2rem;list-style:disc;padding-left:1.5rem;line-height:1.8;margin:0">\n${items}\n</ul>`;
    }
  }

  // ── Structured data ──────────────────────────────────────────────────────
  const faqJsonLd = faq ? buildFaqJsonLd(faq) : "";
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    websiteDomain ?? "",
    serviceName,
    serviceSlug,
    locationName,
    locationType,
    stateName,
    stateAbbr,
  );
  const localBusinessJsonLd = buildLocalBusinessJsonLd(
    brandName,
    serviceName,
    locationName,
    stateName,
    stateAbbr,
    locationType,
  );

  const contentHtml = [
    intro,
    section(`How ${serviceName} Works in ${displayLocation}`, howItWorks),
    section(`Why ${displayLocation} Businesses Choose ${brandName}`, benefits),
    section("Frequently Asked Questions", faq),
    cta
      ? `<div style="background:#2563eb;color:#fff;border-radius:.75rem;padding:2rem;margin:2.5rem 0;text-align:center">\n<h2 style="color:#fff;font-size:1.35rem;font-weight:700;border:none;margin:.5rem 0">Ready to Get Started?</h2>\n${cta}\n</div>`
      : "",
    citiesSection,
    relatedServicesSection,
    faqJsonLd,
    breadcrumbJsonLd,
    localBusinessJsonLd,
  ]
    .filter(Boolean)
    .join("\n");

  const wordCount = contentHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

  const clusterSlug = cluster?.primaryKeyword ? slugify(cluster.primaryKeyword) : null;
  const locationSlug =
    locationType === "state"
      ? slugify(stateName)
      : `${slugify(locationName)}-${stateAbbr.toLowerCase()}`;

  const slug = clusterSlug
    ? `${serviceSlug}--${clusterSlug}--in-${locationSlug}`
    : `${serviceSlug}-in-${locationSlug}`;

  const clusterLabel =
    cluster?.primaryKeyword && cluster.primaryKeyword.toLowerCase() !== serviceName.toLowerCase()
      ? cluster.primaryKeyword
      : null;

  const title =
    locationType === "state"
      ? `${serviceName}${clusterLabel ? ` – ${clusterLabel}` : ""} in ${stateName} | ${brandName}`
      : `${serviceName}${clusterLabel ? ` – ${clusterLabel}` : ""} in ${displayLocation} | ${brandName}`;

  const h1 =
    locationType === "state"
      ? `${serviceName}${clusterLabel ? ` – ${clusterLabel}` : ""} in ${stateName}`
      : `${serviceName}${clusterLabel ? ` – ${clusterLabel}` : ""} in ${displayLocation}`;

  const targetKeyword = cluster?.primaryKeyword ?? serviceName;

  // "near me" phrasing for city pages captures the highest-volume local modifier
  const metaDescription =
    locationType === "city"
      ? `Looking for ${targetKeyword} near ${displayLocation}? ${brandName} provides trusted ${serviceName} to local businesses. Serving the ${locationName} area — get a free quote today.`
      : `Looking for ${targetKeyword} in ${stateName}? ${brandName} delivers reliable ${serviceName} solutions to businesses across ${stateDisplay}. Get a free quote today.`;

  return {
    contentHtml: sanitizeGeoText(contentHtml, geoTarget),
    title: sanitizeGeoText(title, geoTarget),
    h1: sanitizeGeoText(h1, geoTarget),
    metaDescription: sanitizeGeoText(metaDescription, geoTarget),
    slug,
    wordCount,
  };
}
