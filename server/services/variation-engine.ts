import type { ContentVariationBank, StateData } from "@shared/schema";

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

// Parse FAQ HTML into schema.org FAQPage JSON-LD
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
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: entities })}</script>`;
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
): VariationPageResult {
  const landmark = state ? pick(state.landmarks as string[]) : stateName;
  const city = locationType === "state" ? stateName : locationName;
  const stateDisplay = stateName;

  const vars: Record<string, string> = {
    service: serviceName,
    city,
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
    return substitute(pick(variations), vars);
  };

  const intro = getSection("intro");
  const howItWorks = getSection("how_it_works");
  const benefits = getSection("benefits");
  const faq = getSection("faq");
  const cta = getSection("cta");

  const h2Class = "style=\"font-size:1.35rem;font-weight:700;color:#111827;margin:2rem 0 .75rem;padding-bottom:.5rem;border-bottom:2px solid #2563eb20\"";

  const section = (heading: string, body: string) =>
    body ? `<h2 ${h2Class}>${heading}</h2>\n${body}` : "";

  // Internal links: state hub pages link down to every city page for same service
  let citiesSection = "";
  if (locationType === "state" && citiesInState && citiesInState.length > 0) {
    const items = citiesInState
      .map(c => {
        const citySlug = `${serviceSlug}-in-${slugify(c.name)}-${stateAbbr.toLowerCase()}`;
        return `<li style="break-inside:avoid"><a href="/${citySlug}" style="color:#2563eb;text-decoration:none">${c.name}, ${stateAbbr}</a></li>`;
      })
      .join("\n");
    citiesSection = `<h2 ${h2Class}>Cities We Serve in ${stateName}</h2>\n<ul style="columns:3;column-gap:2rem;list-style:disc;padding-left:1.5rem;line-height:2.2;margin:0">\n${items}\n</ul>`;
  }

  // FAQ JSON-LD schema for rich results
  const faqJsonLd = faq ? buildFaqJsonLd(faq) : "";

  const contentHtml = [
    intro,
    section(`How ${serviceName} Works in ${city}, ${stateAbbr}`, howItWorks),
    section(`Why ${city} Businesses Choose ${brandName}`, benefits),
    section("Frequently Asked Questions", faq),
    cta ? `<div style="background:#2563eb;color:#fff;border-radius:.75rem;padding:2rem;margin:2.5rem 0;text-align:center">\n<h2 style="color:#fff;font-size:1.35rem;font-weight:700;border:none;margin:.5rem 0">Ready to Get Started?</h2>\n${cta}\n</div>` : "",
    citiesSection,
    faqJsonLd,
  ].filter(Boolean).join("\n");

  const wordCount = contentHtml.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

  const locationSlug = locationType === "state"
    ? slugify(stateName)
    : `${slugify(locationName)}-${stateAbbr.toLowerCase()}`;

  const slug = `${serviceSlug}-in-${locationSlug}`;

  const title = locationType === "state"
    ? `${serviceName} in ${stateName} | ${brandName}`
    : `${serviceName} in ${city}, ${stateAbbr} | ${brandName}`;

  const h1 = locationType === "state"
    ? `${serviceName} in ${stateName}`
    : `${serviceName} in ${city}, ${stateAbbr}`;

  const targetKeyword = cluster?.primaryKeyword ?? serviceName;
  const metaDescription = `Looking for ${targetKeyword} in ${city}? ${brandName} delivers reliable ${serviceName} solutions to businesses across ${stateDisplay}. Get a free quote today.`;

  return { contentHtml, title, h1, metaDescription, slug, wordCount };
}
