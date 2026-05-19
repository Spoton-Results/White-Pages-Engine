import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { variationGenerations } from "@shared/content-architecture-schema";
import { runGenerationWorkerV2 } from "./generation-worker-v2";
import { runContentReviewPipeline } from "./content-review-pipeline";

export interface QueueCoordinatorOptions {
  generationLimit?: number;
  reviewLimit?: number;
  maxRunningGenerations?: number;
  dryRun?: boolean;
}

export interface QueueCoordinatorResult {
  pendingGenerations: number;
  runningGenerations: number;
  failedGenerations: number;
  generationWorker: Awaited<ReturnType<typeof runGenerationWorkerV2>> | null;
  reviewPipeline: Awaited<ReturnType<typeof runContentReviewPipeline>> | null;
  dryRun: boolean;
}

export async function getContentArchitectureQueueHealth() {
  const pending = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationGenerations)
    .where(eq(variationGenerations.status, "pending"));

  const running = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationGenerations)
    .where(eq(variationGenerations.status, "running"));

  const failed = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationGenerations)
    .where(eq(variationGenerations.status, "failed"));

  const completed = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationGenerations)
    .where(eq(variationGenerations.status, "completed"));

  return {
    pendingGenerations: pending[0]?.count ?? 0,
    runningGenerations: running[0]?.count ?? 0,
    failedGenerations: failed[0]?.count ?? 0,
    completedGenerations: completed[0]?.count ?? 0,
  };
}

export async function releaseStaleRunningGenerations(staleMinutes = 30) {
  const staleRows = await db
    .select({ id: variationGenerations.id })
    .from(variationGenerations)
    .where(
      and(
        eq(variationGenerations.status, "running"),
        sql`${variationGenerations.startedAt} < NOW() - (${staleMinutes} || ' minutes')::interval`,
      ),
    );

  if (staleRows.length === 0) return 0;

  await db
    .update(variationGenerations)
    .set({
      status: "pending",
      errorMessage: "Released stale running generation back to pending",
    })
    .where(inArray(variationGenerations.id, staleRows.map((row) => row.id)));

  return staleRows.length;
}

export async function runContentArchitectureQueue(
  options: QueueCoordinatorOptions = {},
): Promise<QueueCoordinatorResult> {
  const generationLimit = options.generationLimit ?? 5;
  const reviewLimit = options.reviewLimit ?? 50;
  const maxRunningGenerations = options.maxRunningGenerations ?? 3;
  const dryRun = Boolean(options.dryRun);

  await releaseStaleRunningGenerations();
  const health = await getContentArchitectureQueueHealth();

  let generationWorker: QueueCoordinatorResult["generationWorker"] = null;
  let reviewPipeline: QueueCoordinatorResult["reviewPipeline"] = null;

  if (health.runningGenerations < maxRunningGenerations && health.pendingGenerations > 0) {
    const safeLimit = Math.max(0, Math.min(generationLimit, maxRunningGenerations - health.runningGenerations));

    if (safeLimit > 0) {
      generationWorker = await runGenerationWorkerV2({
        limit: safeLimit,
        dryRun,
      });
    }
  }

  reviewPipeline = await runContentReviewPipeline({
    limit: reviewLimit,
    dryRun,
  });

  const after = await getContentArchitectureQueueHealth();

  return {
    pendingGenerations: after.pendingGenerations,
    runningGenerations: after.runningGenerations,
    failedGenerations: after.failedGenerations,
    generationWorker,
    reviewPipeline,
    dryRun,
  };
}

export async function getNextGenerationCandidates(limit = 20) {
  return db
    .select({
      id: variationGenerations.id,
      batchId: variationGenerations.batchId,
      provider: variationGenerations.provider,
      model: variationGenerations.model,
      createdAt: variationGenerations.createdAt,
      status: variationGenerations.status,
    })
    .from(variationGenerations)
    .where(eq(variationGenerations.status, "pending"))
    .orderBy(desc(variationGenerations.batchId), asc(variationGenerations.createdAt))
    .limit(limit);
}
