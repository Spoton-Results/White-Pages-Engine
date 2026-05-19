import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { pageMetrics, pages } from "@shared/schema";

export interface PerformanceFeedbackOptions {
  websiteId?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface PagePerformanceRecommendation {
  pageId: string;
  slug: string;
  action: "PROMOTE" | "REFRESH" | "IMPROVE_CTR" | "PRUNE_REVIEW" | "WAIT";
  priority: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
  metrics: {
    impressions: number;
    clicks: number;
    ctr: number;
    avgPosition: number | null;
  };
}

export interface PerformanceFeedbackResult {
  audited: number;
  promote: number;
  refresh: number;
  improveCtr: number;
  pruneReview: number;
  wait: number;
  recommendations: PagePerformanceRecommendation[];
  dryRun: boolean;
}

function classifyRecommendation(params: {
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number | null;
  qualityScore: number | null;
}): Pick<PagePerformanceRecommendation, "action" | "priority" | "reason"> {
  const { impressions, clicks, ctr, avgPosition, qualityScore } = params;

  if (impressions >= 100 && ctr < 0.01) {
    return {
      action: "IMPROVE_CTR",
      priority: "HIGH",
      reason: "high impressions with weak click-through rate",
    };
  }

  if (impressions >= 50 && avgPosition !== null && avgPosition <= 20 && clicks === 0) {
    return {
      action: "IMPROVE_CTR",
      priority: "MEDIUM",
      reason: "visible in SERP but no clicks",
    };
  }

  if (impressions >= 50 && avgPosition !== null && avgPosition <= 12 && ctr >= 0.03) {
    return {
      action: "PROMOTE",
      priority: "HIGH",
      reason: "page shows ranking traction and acceptable CTR",
    };
  }

  if (impressions < 10 && (qualityScore ?? 0) < 50) {
    return {
      action: "PRUNE_REVIEW",
      priority: "MEDIUM",
      reason: "low impressions and weak quality score",
    };
  }

  if (impressions >= 20 && (qualityScore ?? 0) < 70) {
    return {
      action: "REFRESH",
      priority: "MEDIUM",
      reason: "some demand exists but quality score is not strong enough",
    };
  }

  return {
    action: "WAIT",
    priority: "LOW",
    reason: "insufficient signal for action",
  };
}

export async function runPerformanceFeedbackLoop(
  options: PerformanceFeedbackOptions = {},
): Promise<PerformanceFeedbackResult> {
  const limit = options.limit ?? 250;

  const rows = await db
    .select({
      pageId: pages.id,
      websiteId: pages.websiteId,
      slug: pages.slug,
      status: pages.status,
      tier: pages.tier,
      qualityScore: pages.qualityScore,
      impressions: sql<number>`COALESCE(SUM(${pageMetrics.impressions}), 0)::int`,
      clicks: sql<number>`COALESCE(SUM(${pageMetrics.clicks}), 0)::int`,
      avgPosition: sql<number | null>`CASE WHEN COUNT(${pageMetrics.avgPosition}) = 0 THEN NULL ELSE AVG(${pageMetrics.avgPosition}) END`,
    })
    .from(pages)
    .leftJoin(pageMetrics, eq(pageMetrics.pageId, pages.id))
    .where(options.websiteId ? eq(pages.websiteId, options.websiteId) : undefined)
    .groupBy(pages.id)
    .orderBy(desc(sql`COALESCE(SUM(${pageMetrics.impressions}), 0)`), asc(pages.createdAt))
    .limit(limit);

  const recommendations: PagePerformanceRecommendation[] = [];

  for (const row of rows) {
    const impressions = Number(row.impressions ?? 0);
    const clicks = Number(row.clicks ?? 0);
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const avgPosition = row.avgPosition === null ? null : Number(row.avgPosition);

    const classification = classifyRecommendation({
      impressions,
      clicks,
      ctr,
      avgPosition,
      qualityScore: row.qualityScore,
    });

    recommendations.push({
      pageId: row.pageId,
      slug: row.slug,
      ...classification,
      metrics: {
        impressions,
        clicks,
        ctr: Number(ctr.toFixed(4)),
        avgPosition: avgPosition === null ? null : Number(avgPosition.toFixed(2)),
      },
    });
  }

  if (!options.dryRun) {
    for (const recommendation of recommendations) {
      if (recommendation.action === "PROMOTE") {
        await db
          .update(pages)
          .set({
            promotionStatus: "performance_promote_candidate",
            updatedAt: new Date(),
          })
          .where(eq(pages.id, recommendation.pageId));
      }

      if (recommendation.action === "REFRESH") {
        await db
          .update(pages)
          .set({
            promotionStatus: "refresh_candidate",
            updatedAt: new Date(),
          })
          .where(eq(pages.id, recommendation.pageId));
      }

      if (recommendation.action === "PRUNE_REVIEW") {
        await db
          .update(pages)
          .set({
            promotionStatus: "prune_review_candidate",
            updatedAt: new Date(),
          })
          .where(eq(pages.id, recommendation.pageId));
      }
    }
  }

  return {
    audited: recommendations.length,
    promote: recommendations.filter((r) => r.action === "PROMOTE").length,
    refresh: recommendations.filter((r) => r.action === "REFRESH").length,
    improveCtr: recommendations.filter((r) => r.action === "IMPROVE_CTR").length,
    pruneReview: recommendations.filter((r) => r.action === "PRUNE_REVIEW").length,
    wait: recommendations.filter((r) => r.action === "WAIT").length,
    recommendations,
    dryRun: Boolean(options.dryRun),
  };
}

export async function getPerformanceFeedbackSummary(websiteId?: string) {
  const result = await runPerformanceFeedbackLoop({ websiteId, dryRun: true, limit: 500 });

  return {
    audited: result.audited,
    promote: result.promote,
    refresh: result.refresh,
    improveCtr: result.improveCtr,
    pruneReview: result.pruneReview,
    wait: result.wait,
  };
}
