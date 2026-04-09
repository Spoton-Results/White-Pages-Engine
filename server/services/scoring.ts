/**
 * scoring.ts
 * Quality scoring engine for SEO page inventory control.
 * Scores each page 0–100 across 9 weighted factors.
 *
 * Tier assignment (configurable via minScoreForTier1):
 *   score >= minScoreForTier1 (default 80) → Tier 1  (Google Priority)
 *   score 55–79                            → Tier 2  (Live, Not Promoted)
 *   score < 55                             → Tier 3  (Hidden from Google)
 */

import type { ContentVariationBank } from "@shared/schema";

// ── Configurable weight table ─────────────────────────────────────────────────
// Total must equal 100.
export const SCORING_WEIGHTS = {
  contentDepth:        20,
  bankCompleteness:    15,
  localContext:        15,
  faqPresent:          10,
  proofTrust:          10,
  servicePriority:     10,
  locationPriority:    10,
  internalLinkSupport:  5,
  uniquenessDiversity:  5,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  contentDepth:        number;
  bankCompleteness:    number;
  localContext:        number;
  faqPresent:          number;
  proofTrust:          number;
  servicePriority:     number;
  locationPriority:    number;
  internalLinkSupport: number;
  uniquenessDiversity: number;
  total:               number;
  recommendedTier:     1 | 2 | 3;
}

export interface BankCompletenessResult {
  hasIntro:               boolean;
  hasHowItWorks:          boolean;
  hasBenefits:            boolean;
  hasFaq:                 boolean;
  hasCta:                 boolean;
  totalVariations:        number;
  avgVariationsPerSection: number;
  completenessScore:      number;
  isEligibleForTier1:     boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const SECTION_NAMES = ["intro", "how_it_works", "benefits", "faq", "cta"] as const;

const TRUST_SIGNALS = [
  "review", "testimonial", "rating", "star", "licensed", "insured",
  "certified", "accredited", "bbb", "guarantee", "award", "years of experience",
  "trusted", "verified", "bonded",
];

const LOCAL_SIGNALS = [
  " in ", "local", "serving", "near", "neighborhood", "community",
  "residents", "homeowners", "businesses in",
];

function hasLocalContext(html: string): boolean {
  const lower = html.toLowerCase();
  return LOCAL_SIGNALS.some(sig => lower.includes(sig));
}

function hasProofTrust(html: string): boolean {
  const lower = html.toLowerCase();
  return TRUST_SIGNALS.some(sig => lower.includes(sig));
}

function hasFaq(html: string): boolean {
  const lower = html.toLowerCase();
  return lower.includes("frequently asked") || lower.includes("<h2") && lower.includes("faq");
}

// ── Main scoring function ─────────────────────────────────────────────────────

/**
 * Score a page from 0–100 across 9 quality factors.
 *
 * All parameters after `minScoreForTier1` are optional so existing call-sites
 * that only pass 6 arguments continue to work without change.
 */
export function scorePageContent(
  contentHtml:       string,
  metaDescription:   string,
  title:             string,
  wordCount:         number,
  banks:             ContentVariationBank[],
  minScoreForTier1 = 80,
  // Optional enrichment params — do not break existing callers
  population?:          number,
  isServicePriority?:   boolean,
  internalLinkCount?:   number,
): ScoreBreakdown {
  const w = SCORING_WEIGHTS;

  // 1. Content depth (word count) — 20 pts
  const contentDepth =
    wordCount >= 800 ? w.contentDepth :
    wordCount >= 600 ? Math.round(w.contentDepth * 0.75) :
    wordCount >= 400 ? Math.round(w.contentDepth * 0.40) :
    wordCount >= 200 ? Math.round(w.contentDepth * 0.20) : 0;

  // 2. Bank completeness (section coverage) — 15 pts
  const coveredSections = SECTION_NAMES.filter(s =>
    banks.some(b => b.sectionName === s && (b.variations as string[]).length > 0)
  ).length;
  const allFive = coveredSections === 5;
  const avgVarsForCompleteness = banks.length > 0
    ? banks.reduce((s, b) => s + (b.variations as string[]).length, 0) / banks.length
    : 0;
  const bankCompleteness =
    allFive && avgVarsForCompleteness >= 5 ? w.bankCompleteness :
    allFive                                ? Math.round(w.bankCompleteness * 0.67) :
    coveredSections >= 4                   ? Math.round(w.bankCompleteness * 0.47) :
    coveredSections >= 3                   ? Math.round(w.bankCompleteness * 0.27) : 0;

  // 3. Local context present — 15 pts
  const localContext = hasLocalContext(contentHtml) ? w.localContext :
    contentHtml.toLowerCase().includes(" in ") ? Math.round(w.localContext * 0.5) : 0;

  // 4. FAQ present — 10 pts
  const faqPresent = hasFaq(contentHtml) ? w.faqPresent : 0;

  // 5. Proof / trust block — 10 pts
  const proofTrust = hasProofTrust(contentHtml) ? w.proofTrust : 0;

  // 6. Service business priority — 10 pts
  // If unknown (undefined), assume average service → half credit
  const servicePriority =
    isServicePriority === true  ? w.servicePriority :
    isServicePriority === false ? 0 :
    Math.round(w.servicePriority * 0.5);

  // 7. Location priority by city size — 10 pts
  const locationPriority =
    population === undefined    ? Math.round(w.locationPriority * 0.4) :
    population >= 500_000       ? w.locationPriority :
    population >= 100_000       ? Math.round(w.locationPriority * 0.8) :
    population >= 50_000        ? Math.round(w.locationPriority * 0.6) :
    population >= 10_000        ? Math.round(w.locationPriority * 0.4) :
                                  Math.round(w.locationPriority * 0.2);

  // 8. Internal link support — 5 pts
  const internalLinkSupport =
    internalLinkCount === undefined ? 0 :
    internalLinkCount >= 5          ? w.internalLinkSupport :
    internalLinkCount >= 3          ? Math.round(w.internalLinkSupport * 0.8) :
    internalLinkCount >= 1          ? Math.round(w.internalLinkSupport * 0.4) : 0;

  // 9. Uniqueness / variation diversity — 5 pts
  const avgVars = banks.length > 0
    ? banks.reduce((s, b) => s + (b.variations as string[]).length, 0) / banks.length
    : 0;
  const uniquenessDiversity =
    avgVars >= 10 ? w.uniquenessDiversity :
    avgVars >= 5  ? Math.round(w.uniquenessDiversity * 0.8) :
    avgVars >= 3  ? Math.round(w.uniquenessDiversity * 0.4) :
    avgVars >= 1  ? Math.round(w.uniquenessDiversity * 0.2) : 0;

  const total = Math.min(
    contentDepth + bankCompleteness + localContext + faqPresent + proofTrust +
    servicePriority + locationPriority + internalLinkSupport + uniquenessDiversity,
    100,
  );

  const recommendedTier: 1 | 2 | 3 =
    total >= minScoreForTier1 ? 1 :
    total >= 55               ? 2 : 3;

  return {
    contentDepth,
    bankCompleteness,
    localContext,
    faqPresent,
    proofTrust,
    servicePriority,
    locationPriority,
    internalLinkSupport,
    uniquenessDiversity,
    total,
    recommendedTier,
  };
}

// ── Bank completeness helper ──────────────────────────────────────────────────

export function computeBankCompleteness(
  banks:             ContentVariationBank[],
  minScoreForTier1 = 80,
): BankCompletenessResult {
  const hasIntro      = banks.some(b => b.sectionName === "intro"         && (b.variations as string[]).length > 0);
  const hasHowItWorks = banks.some(b => b.sectionName === "how_it_works"  && (b.variations as string[]).length > 0);
  const hasBenefits   = banks.some(b => b.sectionName === "benefits"      && (b.variations as string[]).length > 0);
  const hasFaq        = banks.some(b => b.sectionName === "faq"           && (b.variations as string[]).length > 0);
  const hasCta        = banks.some(b => b.sectionName === "cta"           && (b.variations as string[]).length > 0);

  const totalVariations = banks.reduce((s, b) => s + (b.variations as string[]).length, 0);
  const avgVariationsPerSection = banks.length > 0
    ? Math.round(totalVariations / banks.length)
    : 0;

  // Completeness: section presence (5 × 10 = 50) + variation depth (50 max)
  const sectionScore = [hasIntro, hasHowItWorks, hasBenefits, hasFaq, hasCta].filter(Boolean).length * 10;
  const depthScore =
    avgVariationsPerSection >= 10 ? 50 :
    avgVariationsPerSection >= 5  ? 35 :
    avgVariationsPerSection >= 3  ? 20 :
    avgVariationsPerSection >= 1  ? 10 : 0;
  const completenessScore = Math.min(sectionScore + depthScore, 100);

  // Eligible for Tier 1 if all 5 sections present AND avg ≥ 5 variations
  const isEligibleForTier1 =
    hasIntro && hasHowItWorks && hasBenefits && hasFaq && hasCta &&
    avgVariationsPerSection >= 5;

  return {
    hasIntro,
    hasHowItWorks,
    hasBenefits,
    hasFaq,
    hasCta,
    totalVariations,
    avgVariationsPerSection,
    completenessScore,
    isEligibleForTier1,
  };
}
