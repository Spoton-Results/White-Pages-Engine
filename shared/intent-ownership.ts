export const INTENT_TYPES = [
  "STATE_HUB",
  "REGION_HUB",
  "METRO_HUB",
  "CITY_HUB",
  "INDUSTRY_CITY",
  "SERVICE_CATEGORY",
  "CITY_SERVICE",
  "PROBLEM_INTENT",
  "SOLUTION_INTENT",
  "COMPARISON_INTENT",
  "PRICING_INTENT",
  "TOOL_INTENT",
  "CALCULATOR_INTENT",
  "CASE_STUDY_INTENT",
  "RESULTS_INTENT",
  "FAQ_INTENT",
  "DEFINITION_INTENT",
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

export const FUNNEL_STAGES = [
  "AWARENESS",
  "PROBLEM_IDENTIFICATION",
  "SOLUTION_DISCOVERY",
  "EVALUATION",
  "PURCHASE_DECISION",
  "TRUST_VALIDATION",
  "POST_PURCHASE",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const SUPPORT_ROLES = [
  "CANONICAL_OWNER",
  "SUPPORTING_PAGE",
  "HUB_PAGE",
  "PROOF_PAGE",
  "UTILITY_PAGE",
  "DEFINITION_PAGE",
  "COMPARISON_PAGE",
  "PRICING_PAGE",
  "FAQ_PAGE",
] as const;

export type SupportRole = (typeof SUPPORT_ROLES)[number];

export const CANNIBALIZATION_RISKS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type CannibalizationRisk = (typeof CANNIBALIZATION_RISKS)[number];

const US_STATE_SLUGS = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia",
  "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland",
  "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new-hampshire", "new-jersey",
  "new-mexico", "new-york", "north-carolina", "north-dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode-island", "south-carolina",
  "south-dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west-virginia", "wisconsin", "wyoming",
  "district-of-columbia",
];

export type IntentOwnershipProfile = {
  primaryIntent: IntentType;
  secondaryIntent?: IntentType;
  intentFamily: string;
  funnelStage: FunnelStage;
  canonicalOwner: boolean;
  supportRole: SupportRole;
  intentCluster: string;
  overlapRisk: number;
  semanticDistance?: number;
  authorityWeight: number;
  cannibalizationRisk: CannibalizationRisk;
};

export function normalizeIntentToken(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function riskFromOverlapScore(score: number): CannibalizationRisk {
  if (score >= 76) return "CRITICAL";
  if (score >= 51) return "HIGH";
  if (score >= 26) return "MEDIUM";
  return "LOW";
}

export function splitStateIntentSlug(slug = ""):
  | { baseSlug: string; locationSlug: string; modifier: string | null }
  | null {
  const normalizedSlug = normalizeIntentToken(slug.split("--")[0]);

  for (const stateSlug of US_STATE_SLUGS) {
    const marker = `-in-${stateSlug}`;
    const markerIndex = normalizedSlug.indexOf(marker);
    if (markerIndex === -1) continue;

    const baseEnd = markerIndex + marker.length;
    const baseSlug = normalizedSlug.slice(0, baseEnd);
    const remainder = normalizedSlug.slice(baseEnd).replace(/^-+/, "");

    return {
      baseSlug,
      locationSlug: stateSlug,
      modifier: remainder || null,
    };
  }

  return null;
}

export function getIntentModifier(slug = ""): string {
  const normalizedSlug = slug.toLowerCase();
  const parts = normalizedSlug.split("--");
  if (parts.length > 1) return normalizeIntentToken(parts.slice(1).join("-"));

  const split = splitStateIntentSlug(slug);
  if (split?.modifier) return split.modifier;

  return normalizeIntentToken(normalizedSlug);
}

export function hasModifierIntentSlug(slug = ""): boolean {
  if (slug.includes("--")) return true;
  return Boolean(splitStateIntentSlug(slug)?.modifier);
}

export function intentTypeFromSlug(slug = ""): IntentType | null {
  const normalizedSlug = normalizeIntentToken(slug);
  const modifier = getIntentModifier(slug);
  const target = modifier || normalizedSlug;

  if (target.includes("-vs-") || target.includes("vs-") || target.includes("comparison") || target.includes("compare") || target.includes("alternative") || target.includes("alternatives")) return "COMPARISON_INTENT";
  if (target.includes("pricing") || target.includes("rates") || target.includes("fees") || target.includes("cost") || target.includes("affordable")) return "PRICING_INTENT";
  if (target.includes("calculator") || target.includes("estimator") || target.includes("checker")) return "CALCULATOR_INTENT";
  if (target.includes("case-study") || target.includes("case-studies")) return "CASE_STUDY_INTENT";
  if (target.includes("results") || target.includes("success-story")) return "RESULTS_INTENT";
  if (target.includes("faq") || target.includes("questions")) return "FAQ_INTENT";
  if (target.includes("what-is") || target.includes("definition") || target.startsWith("define-") || target.startsWith("types-of")) return "DEFINITION_INTENT";
  if (target.includes("how-to") || target.includes("solution") || target.includes("platform") || target.includes("system") || target.includes("benefits") || target.includes("setup")) return "SOLUTION_INTENT";
  if (target.includes("problem") || target.includes("fix") || target.includes("solve") || target.includes("fraud") || target.includes("chargeback") || target.includes("requirements") || target.includes("security") || target.includes("compliance")) return "PROBLEM_INTENT";

  if (hasModifierIntentSlug(slug)) return "PROBLEM_INTENT";
  return null;
}

export function intentTypeFromPageType(pageType: string | null | undefined, slug = ""): IntentType {
  const normalizedPageType = (pageType || "").toLowerCase();
  const slugIntent = intentTypeFromSlug(slug);

  // Modifier slugs like /state--ach-payment-processing or /state-extra-topic
  // are not true hub pages. The slug modifier carries the real intent and must override page_type.
  if (slugIntent) return slugIntent;

  if (normalizedPageType === "state_hub") return "STATE_HUB";
  if (normalizedPageType === "city_hub") return "CITY_HUB";
  if (normalizedPageType === "industry_city") return "INDUSTRY_CITY";
  if (normalizedPageType === "service_city") return "CITY_SERVICE";
  if (normalizedPageType === "problem_intent") return "PROBLEM_INTENT";

  return "CITY_SERVICE";
}

export function funnelStageFromIntent(intent: IntentType): FunnelStage {
  switch (intent) {
    case "STATE_HUB":
    case "REGION_HUB":
    case "METRO_HUB":
    case "CITY_HUB":
    case "INDUSTRY_CITY":
    case "SERVICE_CATEGORY":
    case "FAQ_INTENT":
    case "DEFINITION_INTENT":
      return "AWARENESS";
    case "PROBLEM_INTENT":
      return "PROBLEM_IDENTIFICATION";
    case "SOLUTION_INTENT":
    case "CITY_SERVICE":
      return "SOLUTION_DISCOVERY";
    case "COMPARISON_INTENT":
    case "TOOL_INTENT":
    case "CALCULATOR_INTENT":
      return "EVALUATION";
    case "PRICING_INTENT":
      return "PURCHASE_DECISION";
    case "CASE_STUDY_INTENT":
    case "RESULTS_INTENT":
      return "TRUST_VALIDATION";
    default:
      return "AWARENESS";
  }
}

export function supportRoleFromIntent(intent: IntentType, canonicalOwner = false): SupportRole {
  if (canonicalOwner) return "CANONICAL_OWNER";
  if (intent.endsWith("HUB")) return "HUB_PAGE";
  if (intent === "COMPARISON_INTENT") return "COMPARISON_PAGE";
  if (intent === "PRICING_INTENT") return "PRICING_PAGE";
  if (intent === "TOOL_INTENT" || intent === "CALCULATOR_INTENT") return "UTILITY_PAGE";
  if (intent === "CASE_STUDY_INTENT" || intent === "RESULTS_INTENT") return "PROOF_PAGE";
  if (intent === "FAQ_INTENT") return "FAQ_PAGE";
  if (intent === "DEFINITION_INTENT") return "DEFINITION_PAGE";
  return "SUPPORTING_PAGE";
}

export function buildIntentCluster(page: {
  pageType?: string | null;
  slug?: string | null;
  serviceSlug?: string | null;
  serviceName?: string | null;
  locationSlug?: string | null;
  locationName?: string | null;
  stateCode?: string | null;
  stateName?: string | null;
}): string {
  const primaryIntent = intentTypeFromPageType(page.pageType, page.slug || "");
  const family = normalizeIntentToken(primaryIntent.replace(/_INTENT$/, "").replace(/_HUB$/, "-hub"));
  const service = normalizeIntentToken(page.serviceSlug || page.serviceName || inferServiceFromSlug(page.slug || "") || "general");
  const location = normalizeIntentToken(page.locationSlug || page.locationName || page.stateCode || page.stateName || inferLocationFromSlug(page.slug || "") || "national");
  return [family, service, location].filter(Boolean).join(":");
}

export function inferLocationFromSlug(slug: string): string | null {
  const split = splitStateIntentSlug(slug);
  if (split?.locationSlug) return split.locationSlug;

  const normalizedSlug = normalizeIntentToken(slug.split("--")[0]);
  const match = normalizedSlug.match(/-in-([a-z-]+)$/);
  return match?.[1] || null;
}

export function inferServiceFromSlug(slug: string): string | null {
  const split = splitStateIntentSlug(slug);
  const normalizedSlug = split?.baseSlug || normalizeIntentToken(slug.split("--")[0]);
  const service = normalizedSlug.replace(/-in-[a-z-]+$/, "");
  return service || null;
}
