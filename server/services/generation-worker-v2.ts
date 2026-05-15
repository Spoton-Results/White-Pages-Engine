import crypto from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { callAI } from "./ai-provider";
import {
  variationGenerations,
  variationVersions,
} from "@shared/content-architecture-schema";

export interface GenerationWorkerOptions {
  limit?: number;
  maxTokens?: number;
  temperature?: number;
  dryRun?: boolean;
}

export interface GenerationWorkerResult {
  processed: number;
  completed: number;
  failed: number;
  createdVariationVersionIds: string[];
}

function parseGeneratedVariations(text: string): string[] {
  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            return item.content ?? item.text ?? item.body ?? "";
          }
          return "";
        })
        .filter((item) => typeof item === "string" && item.trim().length > 0);
    }
  } catch {
    // Fall back to text parsing below.
  }

  return trimmed
    .split(/\n\s*(?:---+|\d+[.)]|Variation\s+\d+[:\-])\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 20);
}

function contentHash(content: string) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function wordCount(content: string) {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

function scoreSeed(content: string) {
  const words = wordCount(content);
  const lengthScore = Math.max(30, Math.min(80, Math.round(words / 2)));
  return {
    seoScore: lengthScore,
    freshnessScore: 60,
    uniquenessScore: 60,
    wordCount: words,
  };
}

export async function runGenerationWorkerV2(
  options: GenerationWorkerOptions = {},
): Promise<GenerationWorkerResult> {
  const limit = options.limit ?? 5;
  const maxTokens = options.maxTokens ?? 4096;
  const temperature = options.temperature ?? 0.7;

  const pendingGenerations = await db
    .select()
    .from(variationGenerations)
    .where(eq(variationGenerations.status, "pending"))
    .orderBy(asc(variationGenerations.createdAt))
    .limit(limit);

  const result: GenerationWorkerResult = {
    processed: 0,
    completed: 0,
    failed: 0,
    createdVariationVersionIds: [],
  };

  for (const generation of pendingGenerations) {
    result.processed++;

    if (options.dryRun) continue;

    try {
      await db
        .update(variationGenerations)
        .set({
          status: "running",
          startedAt: new Date(),
        })
        .where(eq(variationGenerations.id, generation.id));

      const aiResult = await callAI({
        prompt: `${generation.prompt}\n\nReturn the result as a JSON array of strings only.`,
        maxTokens,
        temperature,
      });

      const variations = parseGeneratedVariations(aiResult.text);

      if (variations.length === 0) {
        throw new Error("AI returned no usable variations");
      }

      for (const content of variations) {
        const score = scoreSeed(content);
        const rows = await db
          .insert(variationVersions)
          .values({
            generationId: generation.id,
            accountId: generation.accountId,
            websiteId: generation.websiteId,
            serviceId: generation.serviceId,
            locationId: generation.locationId,
            sectionId: generation.sectionId!,
            content,
            contentHash: contentHash(content),
            active: true,
            versionNumber: 1,
            reviewStatus: "approved",
            sourceType: "ai_generated",
            seoScore: score.seoScore,
            freshnessScore: score.freshnessScore,
            uniquenessScore: score.uniquenessScore,
            scoreVersion: "worker-seed-v1",
            scoredAt: new Date(),
            scoreInputs: {
              wordCount: score.wordCount,
              scorer: "generation-worker-v2",
            },
            wordCount: score.wordCount,
            metadata: {
              provider: aiResult.provider,
              generationWorker: "generation-worker-v2",
              batchId: generation.batchId,
            },
          })
          .returning({ id: variationVersions.id });

        if (rows[0]?.id) {
          result.createdVariationVersionIds.push(rows[0].id);
        }
      }

      await db
        .update(variationGenerations)
        .set({
          status: "completed",
          provider: aiResult.provider,
          inputTokens: aiResult.promptTokens,
          outputTokens: aiResult.completionTokens,
          totalTokens: aiResult.promptTokens + aiResult.completionTokens,
          completedAt: new Date(),
          metadata: {
            ...(generation.metadata as Record<string, unknown> | null),
            variationsCreated: variations.length,
            provider: aiResult.provider,
          },
        })
        .where(eq(variationGenerations.id, generation.id));

      result.completed++;
    } catch (error: any) {
      await db
        .update(variationGenerations)
        .set({
          status: "failed",
          errorMessage: error?.message ?? "Unknown generation error",
          completedAt: new Date(),
        })
        .where(eq(variationGenerations.id, generation.id));

      result.failed++;
    }
  }

  return result;
}

export async function retryFailedGenerationV2(generationId: string) {
  const original = await db
    .select()
    .from(variationGenerations)
    .where(and(eq(variationGenerations.id, generationId), eq(variationGenerations.status, "failed")))
    .limit(1);

  if (!original[0]) {
    throw new Error(`Failed generation not found: ${generationId}`);
  }

  const retryKey = crypto
    .createHash("sha256")
    .update(`${generationId}:${Date.now()}`)
    .digest("hex");

  const rows = await db
    .insert(variationGenerations)
    .values({
      accountId: original[0].accountId,
      websiteId: original[0].websiteId,
      serviceId: original[0].serviceId,
      locationId: original[0].locationId,
      blueprintId: original[0].blueprintId,
      sectionId: original[0].sectionId,
      generationJobId: original[0].generationJobId,
      batchId: original[0].batchId,
      idempotencyKey: retryKey,
      provider: original[0].provider,
      model: original[0].model,
      prompt: original[0].prompt,
      systemPrompt: original[0].systemPrompt,
      promptHash: original[0].promptHash,
      temperature: original[0].temperature,
      maxTokens: original[0].maxTokens,
      status: "pending",
      retryOfGenerationId: generationId,
      metadata: {
        ...(original[0].metadata as Record<string, unknown> | null),
        retry: true,
        retryOfGenerationId: generationId,
      },
    })
    .returning({ id: variationGenerations.id });

  return rows[0];
}
