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

  const contentHtml = `
${intro}
<h2 ${h2Class}>How ${serviceName} Works in ${city}, ${stateAbbr}</h2>
${howItWorks}
<h2 ${h2Class}>Why ${city} Businesses Choose ${brandName}</h2>
${benefits}
<h2 ${h2Class}>Frequently Asked Questions</h2>
${faq}
<div style="background:#2563eb;color:#fff;border-radius:.75rem;padding:2rem;margin:2.5rem 0;text-align:center">
<h2 style="color:#fff;font-size:1.35rem;font-weight:700;border:none;margin:.5rem 0">Ready to Get Started?</h2>
${cta}
</div>`.trim();

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

  const metaDescription = `Looking for ${serviceName} in ${city}? ${brandName} delivers reliable ${serviceName} solutions to businesses across ${stateDisplay}. Get a free quote today.`;

  return { contentHtml, title, h1, metaDescription, slug, wordCount };
}
