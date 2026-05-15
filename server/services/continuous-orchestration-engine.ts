import { getContentArchitectureQueueHealth, runContentArchitectureQueue } from "./content-architecture-queue";
import {
  auditPageCannibalizationRisk,
  auditVariationSemanticRisk,
} from "./semantic-content-intelligence";
import { runAutonomousSeoStrategy } from "./autonomous-seo-strategy";
import { runAutonomousExecutionEngine } from "./autonomous-execution-engine";
import { runPerformanceFeedbackLoop } from "./performance-feedback-loop";

export interface ContinuousOrchestrationOptions {
  websiteId?: string;
  dryRun?: boolean;
  cycles?: number;
  generationLimit?: number;
  reviewLimit?: number;
  auditLimit?: number;
  allowExecution?: boolean;
  allowLinkApply?: boolean;
  allowPrune?: boolean;
}

export interface ContinuousOrchestrationCycleResult {
  cycle: number;
  queueHealthBefore: Awaited<ReturnType<typeof getContentArchitectureQueueHealth>>;
  queueResult: Awaited<ReturnType<typeof runContentArchitectureQueue>>;
  semanticVariationResult: Awaited<ReturnType<typeof auditVariationSemanticRisk>>;
  semanticPageResult: Awaited<ReturnType<typeof auditPageCannibalizationRisk>>;
  performanceResult: Awaited<ReturnType<typeof runPerformanceFeedbackLoop>>;
  strategyResult: Awaited<ReturnType<typeof runAutonomousSeoStrategy>>;
  executionResult?: Awaited<ReturnType<typeof runAutonomousExecutionEngine>>;
  queueHealthAfter: Awaited<ReturnType<typeof getContentArchitectureQueueHealth>>;
}

export interface ContinuousOrchestrationResult {
  cyclesRequested: number;
  cyclesCompleted: number;
  dryRun: boolean;
  executionEnabled: boolean;
  results: ContinuousOrchestrationCycleResult[];
}

async function runSingleCycle(
  cycle: number,
  options: ContinuousOrchestrationOptions,
): Promise<ContinuousOrchestrationCycleResult> {
  const queueHealthBefore = await getContentArchitectureQueueHealth();

  const queueResult = await runContentArchitectureQueue({
    generationLimit: options.generationLimit ?? 5,
    reviewLimit: options.reviewLimit ?? 50,
    dryRun: options.dryRun,
  });

  const semanticVariationResult = await auditVariationSemanticRisk({
    websiteId: options.websiteId,
    limit: options.auditLimit ?? 100,
    dryRun: options.dryRun,
  });

  const semanticPageResult = await auditPageCannibalizationRisk({
    websiteId: options.websiteId,
    limit: options.auditLimit ?? 100,
    dryRun: options.dryRun,
  });

  const performanceResult = await runPerformanceFeedbackLoop({
    websiteId: options.websiteId,
    limit: options.auditLimit ?? 250,
    dryRun: options.dryRun,
  });

  const strategyResult = await runAutonomousSeoStrategy({
    websiteId: options.websiteId,
    limit: options.auditLimit ?? 250,
    dryRun: true,
  });

  const executionResult = options.allowExecution
    ? await runAutonomousExecutionEngine({
        websiteId: options.websiteId,
        limit: options.auditLimit ?? 250,
        dryRun: options.dryRun,
        allowLinkApply: options.allowLinkApply,
        allowPrune: options.allowPrune,
      })
    : undefined;

  const queueHealthAfter = await getContentArchitectureQueueHealth();

  return {
    cycle,
    queueHealthBefore,
    queueResult,
    semanticVariationResult,
    semanticPageResult,
    performanceResult,
    strategyResult,
    executionResult,
    queueHealthAfter,
  };
}

export async function runContinuousOrchestration(
  options: ContinuousOrchestrationOptions = {},
): Promise<ContinuousOrchestrationResult> {
  const cycles = Math.max(1, Math.min(options.cycles ?? 1, 25));
  const results: ContinuousOrchestrationCycleResult[] = [];

  for (let cycle = 1; cycle <= cycles; cycle++) {
    const result = await runSingleCycle(cycle, options);
    results.push(result);
  }

  return {
    cyclesRequested: cycles,
    cyclesCompleted: results.length,
    dryRun: Boolean(options.dryRun),
    executionEnabled: Boolean(options.allowExecution),
    results,
  };
}
