import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  contentVariationBanks,
} from "@shared/schema";
import {
  sectionRegistry,
  variationVersions,
} from "@shared/content-architecture-schema";

export interface ContentSelectionInput {
  accountId: string;
  websiteId?: string;
  serviceId?: string;
  locationId?: string;
  sectionKey: string;
  limit?: number;
}

export interface SelectedVariation {
  id: string;
  source: "normalized" | "legacy";
  content: string;
  sectionKey: string;
  seoScore?: number | null;
  freshnessScore?: number | null;
  uniquenessScore?: number | null;
  usageCount?: number | null;
}

/**
 * Long-term content selection engine.
 *
 * Selection priority:
 * 1. New normalized variation_versions
 * 2. Legacy content_variation_banks fallback
 *
 * This allows the platform to migrate incrementally without
 * breaking the current rendering pipeline.
 */
export async function selectBestVariations(
  input: ContentSelectionInput,
): Promise<SelectedVariation[]> {
  const limit = input.limit ?? 5;

  const normalizedResults = await db
    .select({
      id: variationVersions.id,
      content: variationVersions.content,
      seoScore: variationVersions.seoScore,
      freshnessScore: variationVersions.freshnessScore,
      uniquenessScore: variationVersions.uniquenessScore,
      usageCount: variationVersions.usageCount,
      sectionKey: sectionRegistry.key,
    })
    .from(variationVersions)
    .innerJoin(
      sectionRegistry,
      eq(variationVersions.sectionId, sectionRegistry.id),
    )
    .where(
      and(
        eq(variationVersions.accountId, input.accountId),
        eq(variationVersions.active, true),
        eq(sectionRegistry.key, input.sectionKey),
        input.websiteId
          ? or(
              eq(variationVersions.websiteId, input.websiteId),
              isNull(variationVersions.websiteId),
            )
          : undefined,
        input.serviceId
          ? or(
              eq(variationVersions.serviceId, input.serviceId),
              isNull(variationVersions.serviceId),
            )
          : undefined,
        input.locationId
          ? or(
              eq(variationVersions.locationId, input.locationId),
              isNull(variationVersions.locationId),
            )
          : undefined,
      ),
    )
    .orderBy(
      desc(sql`COALESCE(${variationVersions.seoScore}, 0)`),
      desc(sql`COALESCE(${variationVersions.freshnessScore}, 0)`),
      desc(sql`COALESCE(${variationVersions.uniquenessScore}, 0)`),
      asc(sql`COALESCE(${variationVersions.usageCount}, 0)`),
      desc(variationVersions.updatedAt),
    )
    .limit(limit);

  if (normalizedResults.length > 0) {
    return normalizedResults.map((row) => ({
      id: row.id,
      source: "normalized",
      content: row.content,
      sectionKey: row.sectionKey,
      seoScore: row.seoScore,
      freshnessScore: row.freshnessScore,
      uniquenessScore: row.uniquenessScore,
      usageCount: row.usageCount,
    }));
  }

  // LEGACY FALLBACK
  // Current production safety layer.
  // Prevents rendering failures while migration is incomplete.

  const legacyResults = await db
    .select()
    .from(contentVariationBanks)
    .where(
      and(
        eq(contentVariationBanks.accountId, input.accountId),
        input.websiteId
          ? eq(contentVariationBanks.websiteId, input.websiteId)
          : undefined,
      ),
    )
    .limit(1);

  if (legacyResults.length === 0) {
    return [];
  }

  const bank = legacyResults[0] as any;

  const legacyFieldMap: Record<string, string> = {
    hero: "heroVariations",
    intro: "introVariations",
    why_choose_us: "whyChooseUsVariations",
    service_details: "serviceDetailsVariations",
    process: "processVariations",
    service_area: "serviceAreaVariations",
    faq: "faqVariations",
    cta: "ctaVariations",
  };

  const field = legacyFieldMap[input.sectionKey];

  if (!field || !Array.isArray(bank[field])) {
    return [];
  }

  return bank[field]
    .slice(0, limit)
    .map((content: string, index: number) => ({
      id: `legacy-${input.sectionKey}-${index}`,
      source: "legacy",
      content,
      sectionKey: input.sectionKey,
      seoScore: null,
      freshnessScore: null,
      uniquenessScore: null,
      usageCount: null,
    }));
}

export async function selectSingleBestVariation(
  input: ContentSelectionInput,
): Promise<SelectedVariation | null> {
  const results = await selectBestVariations({
    ...input,
    limit: 1,
  });

  return results[0] ?? null;
}
