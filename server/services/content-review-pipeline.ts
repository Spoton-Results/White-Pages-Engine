import { and, eq, ilike, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { variationVersions } from "@shared/content-architecture-schema";

export interface ReviewOptions {
  limit?: number;
  minWords?: number;
  minSeoScore?: number;
  duplicateSimilarityThreshold?: number;
  dryRun?: boolean;
}

export interface ReviewResult {
  reviewed: number;
  approved: number;
  rejected: number;
  flaggedDuplicate: number;
  dryRun: boolean;
}

function calculateReviewScore(content: string, minWords: number) {
  const words = content.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lower = content.toLowerCase();

  let score = 50;
  const reasons: string[] = [];

  if (wordCount >= minWords) score += 15;
  else reasons.push(`too_short:${wordCount}<${minWords}`);

  if (/[.!?]/.test(content)) score += 5;
  else reasons.push("missing_sentence_structure");

  if (!lower.includes("as an ai") && !lower.includes("i cannot") && !lower.includes("i'm unable")) score += 10;
  else reasons.push("ai_refusal_or_ai_phrase_detected");

  if (!/\b(lorem ipsum|placeholder|insert|TODO)\b/i.test(content)) score += 10;
  else reasons.push("placeholder_text_detected");

  if (content.length < 4000) score += 10;
  else reasons.push("possibly_too_long_for_section");

  return {
    score: Math.max(0, Math.min(100, score)),
    wordCount,
    reasons,
  };
}

async function hasExactDuplicate(params: {
  id: string;
  contentHash: string | null;
  accountId: string;
  sectionId: string;
}) {
  if (!params.contentHash) return false;

  const rows = await db
    .select({ id: variationVersions.id })
    .from(variationVersions)
    .where(
      and(
        ne(variationVersions.id, params.id),
        eq(variationVersions.accountId, params.accountId),
        eq(variationVersions.sectionId, params.sectionId),
        eq(variationVersions.contentHash, params.contentHash),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

async function hasLikelyNearDuplicate(content: string, id: string, accountId: string, sectionId: string) {
  const firstMeaningfulPhrase = content
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4)
    .slice(0, 8)
    .join(" ");

  if (firstMeaningfulPhrase.length < 20) return false;

  const rows = await db
    .select({ id: variationVersions.id })
    .from(variationVersions)
    .where(
      and(
        ne(variationVersions.id, id),
        eq(variationVersions.accountId, accountId),
        eq(variationVersions.sectionId, sectionId),
        ilike(variationVersions.content, `%${firstMeaningfulPhrase}%`),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export async function runContentReviewPipeline(
  options: ReviewOptions = {},
): Promise<ReviewResult> {
  const limit = options.limit ?? 50;
  const minWords = options.minWords ?? 35;
  const minSeoScore = options.minSeoScore ?? 60;

  const candidates = await db
    .select()
    .from(variationVersions)
    .where(
      and(
        eq(variationVersions.active, true),
        sql`${variationVersions.reviewStatus} IN ('pending', 'approved')`,
      ),
    )
    .limit(limit);

  const result: ReviewResult = {
    reviewed: 0,
    approved: 0,
    rejected: 0,
    flaggedDuplicate: 0,
    dryRun: Boolean(options.dryRun),
  };

  for (const candidate of candidates) {
    result.reviewed++;

    const review = calculateReviewScore(candidate.content, minWords);
    const exactDuplicate = await hasExactDuplicate({
      id: candidate.id,
      contentHash: candidate.contentHash,
      accountId: candidate.accountId,
      sectionId: candidate.sectionId,
    });
    const nearDuplicate = await hasLikelyNearDuplicate(
      candidate.content,
      candidate.id,
      candidate.accountId,
      candidate.sectionId,
    );

    const rejected =
      review.score < minSeoScore ||
      exactDuplicate ||
      nearDuplicate ||
      review.reasons.some((reason) => reason.includes("placeholder") || reason.includes("ai_refusal"));

    if (exactDuplicate || nearDuplicate) result.flaggedDuplicate++;

    if (options.dryRun) {
      if (rejected) result.rejected++;
      else result.approved++;
      continue;
    }

    await db
      .update(variationVersions)
      .set({
        reviewStatus: rejected ? "rejected" : "approved",
        active: !rejected,
        rejectedReason: rejected
          ? [...review.reasons, exactDuplicate ? "exact_duplicate" : null, nearDuplicate ? "near_duplicate" : null]
              .filter(Boolean)
              .join(",")
          : null,
        seoScore: review.score,
        scoreVersion: "content-review-v1",
        scoredAt: new Date(),
        scoreInputs: {
          reviewScore: review.score,
          wordCount: review.wordCount,
          reasons: review.reasons,
          exactDuplicate,
          nearDuplicate,
        },
        wordCount: review.wordCount,
        updatedAt: new Date(),
      })
      .where(eq(variationVersions.id, candidate.id));

    if (rejected) result.rejected++;
    else result.approved++;
  }

  return result;
}
