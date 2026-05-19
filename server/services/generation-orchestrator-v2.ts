import crypto from "crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { services } from "@shared/schema";
import {
  blueprintSections,
  sectionRegistry,
  variationGenerations,
  variationVersions,
} from "@shared/content-architecture-schema";

export interface GenerationOrchestratorInput {
  accountId: string;
  websiteId?: string;
  blueprintId: string;
  serviceId?: string;
  locationId?: string;
  provider?: string;
  model?: string;
  batchId?: string;
  minVariationsFallback?: number;
  dryRun?: boolean;
}

export interface VariationGenerationTarget {
  sectionId: string;
  sectionKey: string;
  sectionLabel: string;
  sortOrder: number;
  required: boolean;
  minVariations: number;
  existingActiveApprovedCount: number;
  missingCount: number;
  idempotencyKey: string;
  prompt: string;
}

export interface GenerationOrchestratorResult {
  batchId: string;
  targets: VariationGenerationTarget[];
  createdGenerationIds: string[];
  dryRun: boolean;
}

async function getServiceName(serviceId?: string) {
  if (!serviceId) return null;

  const rows = await db
    .select({ name: services.name })
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);

  return rows[0]?.name ?? null;
}

function buildPrompt(params: {
  serviceName?: string | null;
  sectionKey: string;
  sectionLabel: string;
  minVariations: number;
}) {
  const serviceContext = params.serviceName
    ? `Service: ${params.serviceName}`
    : "Service: use the provided blueprint context";

  return [
    "Generate reusable SEO content variations for Nexus.",
    serviceContext,
    `Section key: ${params.sectionKey}`,
    `Section label: ${params.sectionLabel}`,
    `Variation count needed: ${params.minVariations}`,
    "Rules:",
    "- Write production-ready content only.",
    "- Avoid duplicate phrasing across variations.",
    "- Do not include markdown fences.",
    "- Keep content reusable across local service pages unless the section requires localization.",
  ].join("\n");
}

function makeIdempotencyKey(params: {
  accountId: string;
  websiteId?: string;
  blueprintId: string;
  serviceId?: string;
  locationId?: string;
  sectionId: string;
  batchId: string;
}) {
  return crypto
    .createHash("sha256")
    .update(
      [
        params.accountId,
        params.websiteId ?? "global",
        params.blueprintId,
        params.serviceId ?? "all-services",
        params.locationId ?? "all-locations",
        params.sectionId,
        params.batchId,
      ].join(":"),
    )
    .digest("hex");
}

export async function planVariationGeneration(
  input: GenerationOrchestratorInput,
): Promise<GenerationOrchestratorResult> {
  const batchId = input.batchId ?? `content-arch-${Date.now()}`;
  const serviceName = await getServiceName(input.serviceId);
  const minVariationsFallback = input.minVariationsFallback ?? 5;

  const sections = await db
    .select({
      sectionId: sectionRegistry.id,
      sectionKey: sectionRegistry.key,
      sectionLabel: sectionRegistry.label,
      sortOrder: blueprintSections.sortOrder,
      required: blueprintSections.required,
      minVariations: blueprintSections.minVariations,
    })
    .from(blueprintSections)
    .innerJoin(sectionRegistry, eq(blueprintSections.sectionId, sectionRegistry.id))
    .where(eq(blueprintSections.blueprintId, input.blueprintId))
    .orderBy(asc(blueprintSections.sortOrder));

  const targets: VariationGenerationTarget[] = [];

  for (const section of sections) {
    const activeApprovedCountRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(variationVersions)
      .where(
        and(
          eq(variationVersions.accountId, input.accountId),
          eq(variationVersions.sectionId, section.sectionId),
          eq(variationVersions.active, true),
          eq(variationVersions.reviewStatus, "approved"),
          input.websiteId ? eq(variationVersions.websiteId, input.websiteId) : undefined,
          input.serviceId ? eq(variationVersions.serviceId, input.serviceId) : undefined,
          input.locationId ? eq(variationVersions.locationId, input.locationId) : undefined,
        ),
      );

    const existingActiveApprovedCount = activeApprovedCountRows[0]?.count ?? 0;
    const minVariations = section.minVariations || minVariationsFallback;
    const missingCount = Math.max(0, minVariations - existingActiveApprovedCount);

    if (missingCount === 0) continue;

    const idempotencyKey = makeIdempotencyKey({
      accountId: input.accountId,
      websiteId: input.websiteId,
      blueprintId: input.blueprintId,
      serviceId: input.serviceId,
      locationId: input.locationId,
      sectionId: section.sectionId,
      batchId,
    });

    targets.push({
      sectionId: section.sectionId,
      sectionKey: section.sectionKey,
      sectionLabel: section.sectionLabel,
      sortOrder: section.sortOrder,
      required: section.required,
      minVariations,
      existingActiveApprovedCount,
      missingCount,
      idempotencyKey,
      prompt: buildPrompt({
        serviceName,
        sectionKey: section.sectionKey,
        sectionLabel: section.sectionLabel,
        minVariations: missingCount,
      }),
    });
  }

  return {
    batchId,
    targets,
    createdGenerationIds: [],
    dryRun: true,
  };
}

export async function createGenerationQueue(
  input: GenerationOrchestratorInput,
): Promise<GenerationOrchestratorResult> {
  const plan = await planVariationGeneration(input);

  if (input.dryRun) {
    return plan;
  }

  const provider = input.provider ?? "anthropic";
  const model = input.model ?? "claude-haiku-4-5-20251001";
  const createdGenerationIds: string[] = [];

  for (const target of plan.targets) {
    const existing = await db
      .select({ id: variationGenerations.id })
      .from(variationGenerations)
      .where(eq(variationGenerations.idempotencyKey, target.idempotencyKey))
      .limit(1);

    if (existing[0]?.id) {
      createdGenerationIds.push(existing[0].id);
      continue;
    }

    const rows = await db
      .insert(variationGenerations)
      .values({
        accountId: input.accountId,
        websiteId: input.websiteId,
        serviceId: input.serviceId,
        locationId: input.locationId,
        blueprintId: input.blueprintId,
        sectionId: target.sectionId,
        batchId: plan.batchId,
        idempotencyKey: target.idempotencyKey,
        provider,
        model,
        prompt: target.prompt,
        status: "pending",
        metadata: {
          orchestrator: "generation-orchestrator-v2",
          sectionKey: target.sectionKey,
          sectionLabel: target.sectionLabel,
          missingCount: target.missingCount,
          minVariations: target.minVariations,
          existingActiveApprovedCount: target.existingActiveApprovedCount,
        },
      })
      .returning({ id: variationGenerations.id });

    if (rows[0]?.id) {
      createdGenerationIds.push(rows[0].id);
    }
  }

  return {
    ...plan,
    createdGenerationIds,
    dryRun: false,
  };
}
