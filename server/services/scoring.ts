/**
 * scoring.ts
 * Quality scoring engine for SEO page inventory control.
 * Scores each page 0-100 across 7 factors.
 * Tier assignment: ≥80 = Tier 1 (Google Priority), 50-79 = Tier 2 (Live), <50 = Tier 3 (Hidden)
 */
import type { ContentVariationBank } from "@shared/schema";

export interface ScoreBreakdown {
  wordCount: number;
  sectionCoverage: number;
  variationDepth: number;
  faqPresent: number;
  structuredData: number;
  metaDescription: number;
  titlePattern: number;
  total: number;
  recommendedTier: 1 | 2 | 3;
}

export interface BankCompletenessResult {
  hasIntro: boolean;
  hasHowItWorks: boolean;
  hasBenefits: boolean;
  hasFaq: boolean;
  hasCta: boolean;
  totalVariations: number;
  avgVariationsPerSection: number;
  completenessScore: number;
  isEligibleForTier1: boolean;
}

const SECTION_NAMES = ["intro", "how_it_works", "benefits", "faq", "cta"] as const;

export function scorePageContent(
  contentHtml: string,
  metaDescription: string,
  title: string,
  wordCount: number,
  banks: ContentVariationBank[],
  minScoreForTier1 = 80,
): ScoreBreakdown {
  let score = 0;

  // Factor 1: Word count (25 pts)
  const wordPts =
    wordCount >= 800 ? 25 :
    wordCount >= 600 ? 18 :
    wordCount >= 400 ? 10 :
    wordCount >= 200 ? 5 : 0;
  score += wordPts;

  // Factor 2: Section coverage (20 pts — 4 pts per section)
  const coveredSections = SECTION_NAMES.filter(s =>
    banks.some(b => b.sectionName === s && (b.variations as string[]).length > 0)
  ).length;
  const sectionPts = coveredSections * 4;
  score += sectionPts;

  // Factor 3: Variation depth (15 pts)
  let varPts = 0;
  if (banks.length > 0) {
    const totalVars = banks.reduce((s, b) => s + (b.variations as string[]).length, 0);
    const avgVars = totalVars / banks.length;
    varPts = avgVars >= 10 ? 15 : avgVars >= 5 ? 10 : avgVars >= 3 ? 5 : avgVars >= 1 ? 2 : 0;
  }
  score += varPts;

  // Factor 4: FAQ present in HTML (10 pts)
  const faqPts = contentHtml.includes("Frequently Asked Questions") ? 10 : 0;
  score += faqPts;

  // Factor 5: Structured data in HTML (10 pts)
  const schemaPts = contentHtml.includes("application/ld+json") ? 10 : 0;
  score += schemaPts;

  // Factor 6: Meta description quality (10 pts)
  const metaLen = (metaDescription || "").length;
  const metaPts = (metaLen >= 120 && metaLen <= 160) ? 10 : metaLen >= 80 ? 5 : 0;
  score += metaPts;

  // Factor 7: Title has service + "in" + location pattern (10 pts)
  const titlePts = /\S+\s+in\s+\S+/i.test(title) ? 10 : 0;
  score += titlePts;

  const total = Math.min(score, 100);
  const recommendedTier: 1 | 2 | 3 =
    total >= minScoreForTier1 ? 1 :
    total >= 50 ? 2 : 3;

  return {
    wordCount: wordPts,
    sectionCoverage: sectionPts,
    variationDepth: varPts,
    faqPresent: faqPts,
    structuredData: schemaPts,
    metaDescription: metaPts,
    titlePattern: titlePts,
    total,
    recommendedTier,
  };
}

export function computeBankCompleteness(
  banks: ContentVariationBank[],
  minScoreForTier1 = 80,
): BankCompletenessResult {
  const hasIntro = banks.some(b => b.sectionName === "intro" && (b.variations as string[]).length > 0);
  const hasHowItWorks = banks.some(b => b.sectionName === "how_it_works" && (b.variations as string[]).length > 0);
  const hasBenefits = banks.some(b => b.sectionName === "benefits" && (b.variations as string[]).length > 0);
  const hasFaq = banks.some(b => b.sectionName === "faq" && (b.variations as string[]).length > 0);
  const hasCta = banks.some(b => b.sectionName === "cta" && (b.variations as string[]).length > 0);

  const totalVariations = banks.reduce((s, b) => s + (b.variations as string[]).length, 0);
  const avgVariationsPerSection = banks.length > 0 ? Math.round(totalVariations / banks.length) : 0;

  // Completeness score: section presence (5×10=50) + variation depth (50 max)
  const sectionScore = [hasIntro, hasHowItWorks, hasBenefits, hasFaq, hasCta].filter(Boolean).length * 10;
  const depthScore =
    avgVariationsPerSection >= 10 ? 50 :
    avgVariationsPerSection >= 5 ? 35 :
    avgVariationsPerSection >= 3 ? 20 :
    avgVariationsPerSection >= 1 ? 10 : 0;
  const completenessScore = Math.min(sectionScore + depthScore, 100);

  // Eligible for Tier 1 if all 5 sections present AND avg ≥ 5 variations
  const isEligibleForTier1 = hasIntro && hasHowItWorks && hasBenefits && hasFaq && hasCta && avgVariationsPerSection >= 5;

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
