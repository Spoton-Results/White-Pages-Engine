import { eq } from "drizzle-orm";
import { db } from "../db";
import { pages } from "@shared/schema";
import { applyRelationshipOpportunities } from "./relationship-intelligence";
import { runAutonomousSeoStrategy, StrategicAction } from "./autonomous-seo-strategy";

export interface AutonomousExecutionOptions {
  websiteId?: string;
  limit?: number;
  dryRun?: boolean;
  allowPrune?: boolean;
  allowLinkApply?: boolean;
}

export interface ExecutionTask {
  actionType: StrategicAction["type"];
  pageId?: string;
  slug?: string;
  status: "planned" | "executed" | "skipped" | "failed";
  result: string;
  evidence?: Record<string, unknown>;
}

export interface AutonomousExecutionResult {
  planned: number;
  executed: number;
  skipped: number;
  failed: number;
  tasks: ExecutionTask[];
  dryRun: boolean;
}

async function executePageAction(action: StrategicAction, options: AutonomousExecutionOptions): Promise<ExecutionTask> {
  if (!action.pageId) {
    return {
      actionType: action.type,
      status: "skipped",
      result: "No pageId attached to action",
      evidence: action.evidence,
    };
  }

  if (options.dryRun) {
    return {
      actionType: action.type,
      pageId: action.pageId,
      slug: action.slug,
      status: "planned",
      result: "Dry run only",
      evidence: action.evidence,
    };
  }

  const statusMap: Partial<Record<StrategicAction["type"], string>> = {
    PROMOTE_PAGE: "execution_promote",
    REFRESH_PAGE: "execution_refresh_queued",
    IMPROVE_CTR: "execution_ctr_rewrite_queued",
    PRUNE_REVIEW: options.allowPrune ? "execution_prune_review" : "execution_prune_review_requires_approval",
  };

  const promotionStatus = statusMap[action.type];

  if (!promotionStatus) {
    return {
      actionType: action.type,
      pageId: action.pageId,
      slug: action.slug,
      status: "skipped",
      result: `No direct page execution handler for ${action.type}`,
      evidence: action.evidence,
    };
  }

  await db
    .update(pages)
    .set({
      promotionStatus,
      updatedAt: new Date(),
    })
    .where(eq(pages.id, action.pageId));

  return {
    actionType: action.type,
    pageId: action.pageId,
    slug: action.slug,
    status: "executed",
    result: `Updated page promotionStatus=${promotionStatus}`,
    evidence: action.evidence,
  };
}

export async function runAutonomousExecutionEngine(
  options: AutonomousExecutionOptions = {},
): Promise<AutonomousExecutionResult> {
  const strategy = await runAutonomousSeoStrategy({
    websiteId: options.websiteId,
    limit: options.limit ?? 250,
    dryRun: true,
  });

  const tasks: ExecutionTask[] = [];

  for (const action of strategy.actions) {
    try {
      if (action.type === "BUILD_INTERNAL_LINKS") {
        if (options.dryRun || !options.allowLinkApply) {
          tasks.push({
            actionType: action.type,
            status: options.dryRun ? "planned" : "skipped",
            result: options.dryRun ? "Dry run only" : "Link apply disabled",
            evidence: action.evidence,
          });
          continue;
        }

        const linkResult = await applyRelationshipOpportunities({
          websiteId: options.websiteId,
          limit: options.limit ?? 250,
          dryRun: false,
        });

        tasks.push({
          actionType: action.type,
          status: "executed",
          result: `Inserted ${linkResult.inserted} semantic internal links`,
          evidence: action.evidence,
        });
        continue;
      }

      if (action.type === "EXPAND_CLUSTER") {
        tasks.push({
          actionType: action.type,
          status: "planned",
          result: "Cluster expansion requires generation-orchestrator integration in the next execution stage",
          evidence: action.evidence,
        });
        continue;
      }

      if (action.type === "MONITOR") {
        tasks.push({
          actionType: action.type,
          status: "skipped",
          result: "Monitor action requires no execution",
          evidence: action.evidence,
        });
        continue;
      }

      tasks.push(await executePageAction(action, options));
    } catch (error: any) {
      tasks.push({
        actionType: action.type,
        pageId: action.pageId,
        slug: action.slug,
        status: "failed",
        result: error?.message ?? "Unknown execution error",
        evidence: action.evidence,
      });
    }
  }

  return {
    planned: tasks.filter((task) => task.status === "planned").length,
    executed: tasks.filter((task) => task.status === "executed").length,
    skipped: tasks.filter((task) => task.status === "skipped").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    tasks,
    dryRun: Boolean(options.dryRun),
  };
}
