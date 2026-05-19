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

export function intentTypeFromPageType(pageType: string | null | undefined, slug = ""): IntentType {
  const normalizedPageType = (pageType || "").toLowerCase();
  const normalizedSlug = slug.toLowerCase();

  if (normalizedPageType === "state_hub") return "STATE_HUB";
  if (normalizedPageType === "city_hub") return "CITY_HUB";
  if (normalizedPageType === "industry_city") return "INDUSTRY_CITY";
  if (normalizedPageType === "service_city") return "CITY_SERVICE";
  if (normalizedPageType === "problem_intent") return "PROBLEM_INTENT";

  if (normalizedSlug.includes("-vs-") || normalizedSlug.includes("-alternative") || normalizedSlug.includes("comparison")) return "COMPARISON_INTENT";
  if (normalizedSlug.includes("pricing") || normalizedSlug.includes("rates") || normalizedSlug.includes("cost")) return "PRICING_INTENT";
  if (normalizedSlug.includes("calculator") || normalizedSlug.includes("estimator")) return "CALCULATOR_INTENT";
  if (normalizedSlug.includes("case-study") || normalizedSlug.includes("results")) return "CASE_STUDY_INTENT";
  if (normalizedSlug.includes("faq") || normalizedSlug.includes("questions")) return "FAQ_INTENT";
  if (normalizedSlug.includes("what-is") || normalizedSlug.includes("definition")) return "DEFINITION_INTENT";
  if (normalizedSlug.includes("solution")) return "SOLUTION_INTENT";
  if (normalizedSlug.includes("problem") || normalizedSlug.includes("fix") || normalizedSlug.includes("solve")) return "PROBLEM_INTENT";

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
  const pageType = normalizeIntentToken(page.pageType || "page");
  const service = normalizeIntentToken(page.serviceSlug || page.serviceName || "general");
  const location = normalizeIntentToken(page.locationSlug || page.locationName || page.stateCode || page.stateName || "national");
  return [pageType, service, location].filter(Boolean).join(":");
}
