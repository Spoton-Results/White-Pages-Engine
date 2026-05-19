import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { pages } from "@shared/schema";
import { runPerformanceFeedbackLoop } from "./performance-feedback-loop";
import { auditPageCannibalizationRisk } from "./semantic-content-intelligence";
import { auditRelationshipIntelligence } from "./relationship-intelligence";

export type StrategicActionType =
  | "EXPAND_CLUSTER"
  | "REFRESH_PAGE"
  | "IMPROVE_CTR"
  | "PROMOTE_PAGE"
  | "PRUNE_REVIEW"
  | "BUILD_INTERNAL_LINKS"
  | "MONITOR";

export interface StrategicAction {
  type: StrategicActionType;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  pageId?: string;
  slug?: string;
  reason: string;
  evidence: Record<string, unknown>;
  score: number;
}

export interface AutonomousStrategyOptions {
  websiteId?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface AutonomousStrategyResult {
  actions: StrategicAction[];
  counts: Record<StrategicActionType, number>;
  dryRun: boolean;
}

function priorityFromScore(score: number): StrategicAction["priority"] {
  if (score >= 90) return "CRITICAL";
  if (score >= 75) return "HIGH";
  if (score >= 50) return "MEDIUM";
  return "LOW";
}

function increment(counts: Record<StrategicActionType, number>, type: StrategicActionType) {
  counts[type] = (counts[type] ?? 0) + 1;
}

export async function runAutonomousSeoStrategy(
  options: AutonomousStrategyOptions = {},
): Promise<AutonomousStrategyResult> {
  const limit = options.limit ?? 250;

  const performance = await runPerformanceFeedbackLoop({
    websiteId: options.websiteId,
    limit,
    dryRun: true,
  });

  const semantic = await auditPageCannibalizationRisk({
    websiteId: options.websiteId,
    limit,
    dryRun: true,
  });

  const relationship = await auditRelationshipIntelligence({
    websiteId: options.websiteId,
    limit,
    dryRun: true,
  });

  const actions: StrategicAction[] = [];

  for (const recommendation of performance.recommendations) {
    if (recommendation.action === "PROMOTE") {
      const score = 90;
      actions.push({
        type: "PROMOTE_PAGE",
        priority: priorityFromScore(score),
        pageId: recommendation.pageId,
        slug: recommendation.slug,
        reason: recommendation.reason,
        evidence: recommendation.metrics,
        score,
      });
    }

    if (recommendation.action === "REFRESH") {
      const score = 70;
      actions.push({
        type: "REFRESH_PAGE",
        priority: priorityFromScore(score),
        pageId: recommendation.pageId,
        slug: recommendation.slug,
        reason: recommendation.reason,
        evidence: recommendation.metrics,
        score,
      });
    }

    if (recommendation.action === "IMPROVE_CTR") {
      const score = recommendation.priority === "HIGH" ? 85 : 65;
      actions.push({
        type: "IMPROVE_CTR",
        priority: priorityFromScore(score),
        pageId: recommendation.pageId,
        slug: recommendation.slug,
        reason: recommendation.reason,
        evidence: recommendation.metrics,
        score,
      });
    }

    if (recommendation.action === "PRUNE_REVIEW") {
      const score = 60;
      actions.push({
        type: "PRUNE_REVIEW",
        priority: priorityFromScore(score),
        pageId: recommendation.pageId,
        slug: recommendation.slug,
        reason: recommendation.reason,
        evidence: recommendation.metrics,
        score,
      });
    }
  }

  for (const semanticRisk of semantic.results) {
    if (semanticRisk.risk === "HIGH") {
      actions.push({
        type: "PRUNE_REVIEW",
        priority: "HIGH",
        pageId: semanticRisk.id,
        reason: "high semantic cannibalization risk",
        evidence: {
          semanticScore: semanticRisk.score,
          reasons: semanticRisk.reasons,
        },
        score: 80,
      });
    }
  }

  if (relationship.orphanPages > 0 || relationship.weakPages > 0) {
    actions.push({
      type: "BUILD_INTERNAL_LINKS",
      priority: relationship.orphanPages > 10 ? "HIGH" : "MEDIUM",
      reason: "site graph has orphan or weakly connected pages",
      evidence: {
        orphanPages: relationship.orphanPages,
        weakPages: relationship.weakPages,
        opportunities: relationship.opportunities.length,
      },
      score: relationship.orphanPages > 10 ? 82 : 65,
    });
  }

  const tractionPages = performance.recommendations.filter(
    (item) => item.action === "PROMOTE" && item.metrics.impressions >= 50,
  );

  if (tractionPages.length >= 3) {
    actions.push({
      type: "EXPAND_CLUSTER",
      priority: "HIGH",
      reason: "multiple pages show performance traction and may support cluster expansion",
      evidence: {
        tractionPages: tractionPages.slice(0, 10).map((page) => ({
          pageId: page.pageId,
          slug: page.slug,
          metrics: page.metrics,
        })),
      },
      score: 84,
    });
  }

  if (actions.length === 0) {
    actions.push({
      type: "MONITOR",
      priority: "LOW",
      reason: "no strong strategic action detected",
      evidence: {},
      score: 25,
    });
  }

  const orderedActions = actions.sort((a, b) => b.score - a.score).slice(0, 100);

  if (!options.dryRun) {
    for (const action of orderedActions) {
      if (!action.pageId) continue;

      const promotionStatus =
        action.type === "PROMOTE_PAGE"
          ? "strategy_promote"
          : action.type === "REFRESH_PAGE"
            ? "strategy_refresh"
            : action.type === "PRUNE_REVIEW"
              ? "strategy_prune_review"
              : action.type === "IMPROVE_CTR"
                ? "strategy_ctr_improve"
                : undefined;

      if (!promotionStatus) continue;

      await db
        .update(pages)
        .set({
          promotionStatus,
          updatedAt: new Date(),
        })
        .where(eq(pages.id, action.pageId));
    }
  }

  const counts = orderedActions.reduce((acc, action) => {
    increment(acc, action.type);
    return acc;
  }, {} as Record<StrategicActionType, number>);

  return {
    actions: orderedActions,
    counts,
    dryRun: Boolean(options.dryRun),
  };
}

export async function getAutonomousStrategySummary(websiteId?: string) {
  const result = await runAutonomousSeoStrategy({
    websiteId,
    dryRun: true,
    limit: 500,
  });

  return {
    totalActions: result.actions.length,
    counts: result.counts,
    topActions: result.actions.slice(0, 10),
  };
}
