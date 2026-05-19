import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { contentVariationBanks } from "@shared/schema";
import {
  sectionRegistry,
  variationVersions,
} from "@shared/content-architecture-schema";

export interface ContentSelectionInput {
  accountId: string;
  websiteId?: string;
  serviceId?: string;
  serviceName?: string;
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

const LEGACY_SECTION_ALIASES: Record<string, string[]> = {
  hero: ["hero", "hero_headline", "headline"],
  intro: ["intro", "introduction", "introduction_paragraph"],
  why_choose_us: ["why_choose_us", "why choose us", "benefits"],
  service_details: ["service_details", "service details", "details"],
  process: ["process", "how_it_works", "how it works"],
  service_area: ["service_area", "service area", "local_context"],
  faq: ["faq", "faqs", "questions"],
  cta: ["cta", "call_to_action", "call to action"],
};

function normalizeSectionKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function legacySectionMatches(sectionKey: string, legacySectionName: string) {
  const normalizedLegacy = normalizeSectionKey(legacySectionName);
  const aliases = LEGACY_SECTION_ALIASES[sectionKey] ?? [sectionKey];
  return aliases.map(normalizeSectionKey).includes(normalizedLegacy);
}

function normalizeLegacyVariation(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["content", "text", "html", "body", "value"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return null;
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
    .innerJoin(sectionRegistry, eq(variationVersions.sectionId, sectionRegistry.id))
    .where(
      and(
        eq(variationVersions.accountId, input.accountId),
        eq(variationVersions.active, true),
        eq(sectionRegistry.key, input.sectionKey),
        input.websiteId
          ? or(eq(variationVersions.websiteId, input.websiteId), isNull(variationVersions.websiteId))
          : undefined,
        input.serviceId
          ? or(eq(variationVersions.serviceId, input.serviceId), isNull(variationVersions.serviceId))
          : undefined,
        input.locationId
          ? or(eq(variationVersions.locationId, input.locationId), isNull(variationVersions.locationId))
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

  const legacyRows = await db
    .select()
    .from(contentVariationBanks)
    .where(
      and(
        eq(contentVariationBanks.accountId, input.accountId),
        input.websiteId ? eq(contentVariationBanks.websiteId, input.websiteId) : undefined,
        input.serviceName ? ilike(contentVariationBanks.service, input.serviceName) : undefined,
      ),
    );

  const matchingLegacyRow = legacyRows.find((row) =>
    legacySectionMatches(input.sectionKey, row.sectionName),
  );

  if (!matchingLegacyRow || !Array.isArray(matchingLegacyRow.variations)) {
    return [];
  }

  return matchingLegacyRow.variations
    .map(normalizeLegacyVariation)
    .filter((content): content is string => Boolean(content && content.trim().length > 0))
    .slice(0, limit)
    .map((content, index) => ({
      id: `legacy-${matchingLegacyRow.id}-${index}`,
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
  const results = await selectBestVariations({ ...input, limit: 1 });
  return results[0] ?? null;
}
