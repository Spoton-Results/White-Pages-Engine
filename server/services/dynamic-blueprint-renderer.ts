import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  blueprintSections,
  publishedPageSections,
  sectionRegistry,
} from "@shared/content-architecture-schema";
import { selectSingleBestVariation } from "./content-selection-engine";

export interface RenderBlueprintInput {
  accountId: string;
  websiteId?: string;
  pageId?: string;
  blueprintId: string;
  serviceId?: string;
  serviceName?: string;
  locationId?: string;
}

export interface RenderedSection {
  sectionKey: string;
  label: string;
  sortOrder: number;
  content: string;
  source: "normalized" | "legacy" | "missing";
}

export interface RenderBlueprintResult {
  sections: RenderedSection[];
  html: string;
  missingSections: string[];
}

/**
 * Dynamic blueprint renderer.
 *
 * Replaces hardcoded 8-section rendering.
 *
 * Flow:
 * 1. Read blueprint_sections
 * 2. Resolve section registry entries
 * 3. Select best variation for each section
 * 4. Assemble ordered render output
 * 5. Optionally snapshot published sections
 */
export async function renderBlueprint(
  input: RenderBlueprintInput,
): Promise<RenderBlueprintResult> {
  const blueprintSectionRows = await db
    .select({
      blueprintSectionId: blueprintSections.id,
      sortOrder: blueprintSections.sortOrder,
      required: blueprintSections.required,
      sectionId: sectionRegistry.id,
      sectionKey: sectionRegistry.key,
      sectionLabel: sectionRegistry.label,
    })
    .from(blueprintSections)
    .innerJoin(sectionRegistry, eq(blueprintSections.sectionId, sectionRegistry.id))
    .where(eq(blueprintSections.blueprintId, input.blueprintId))
    .orderBy(asc(blueprintSections.sortOrder));

  const renderedSections: RenderedSection[] = [];
  const missingSections: string[] = [];

  for (const section of blueprintSectionRows) {
    const selectedVariation = await selectSingleBestVariation({
      accountId: input.accountId,
      websiteId: input.websiteId,
      serviceId: input.serviceId,
      serviceName: input.serviceName,
      locationId: input.locationId,
      sectionKey: section.sectionKey,
    });

    if (!selectedVariation) {
      missingSections.push(section.sectionKey);

      renderedSections.push({
        sectionKey: section.sectionKey,
        label: section.sectionLabel,
        sortOrder: section.sortOrder,
        content: "",
        source: "missing",
      });

      continue;
    }

    renderedSections.push({
      sectionKey: section.sectionKey,
      label: section.sectionLabel,
      sortOrder: section.sortOrder,
      content: selectedVariation.content,
      source: selectedVariation.source,
    });
  }

  const html = renderedSections
    .filter((section) => section.content.trim().length > 0)
    .map(
      (section) => `
<section data-section="${section.sectionKey}">
  <div class="section-inner">
    ${section.content}
  </div>
</section>`,
    )
    .join("\n");

  return {
    sections: renderedSections,
    html,
    missingSections,
  };
}

export async function snapshotRenderedSections(params: {
  pageId: string;
  renderedSections: RenderedSection[];
}) {
  for (const section of params.renderedSections) {
    if (!section.content.trim()) continue;

    const registryRow = await db
      .select({ id: sectionRegistry.id })
      .from(sectionRegistry)
      .where(eq(sectionRegistry.key, section.sectionKey))
      .limit(1);

    if (registryRow.length === 0) continue;

    await db.insert(publishedPageSections).values({
      pageId: params.pageId,
      sectionId: registryRow[0].id,
      contentSnapshot: section.content,
      sortOrder: section.sortOrder,
      renderMetadata: {
        source: section.source,
      },
    });
  }
}
