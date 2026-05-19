import { getContentArchitectureQueueHealth } from "./content-architecture-queue";
import { getAutonomousStrategySummary } from "./autonomous-seo-strategy";
import { getPerformanceFeedbackSummary } from "./performance-feedback-loop";

export interface OrchestrationHealthSnapshot {
  timestamp: string;
  queue: Awaited<ReturnType<typeof getContentArchitectureQueueHealth>>;
  performance: Awaited<ReturnType<typeof getPerformanceFeedbackSummary>>;
  strategy: Awaited<ReturnType<typeof getAutonomousStrategySummary>>;
  status: "HEALTHY" | "WARNING" | "CRITICAL";
  warnings: string[];
}

export async function getOrchestrationHealthSnapshot(): Promise<OrchestrationHealthSnapshot> {
  const queue = await getContentArchitectureQueueHealth();
  const performance = await getPerformanceFeedbackSummary();
  const strategy = await getAutonomousStrategySummary();

  const warnings: string[] = [];

  if ((queue.failedGenerations ?? 0) > 25) {
    warnings.push("High failed generation count");
  }

  if ((queue.pendingGenerations ?? 0) > 1000) {
    warnings.push("Generation backlog growing");
  }

  if ((performance.pruneReview ?? 0) > (performance.promote ?? 0) * 3) {
    warnings.push("Weak page accumulation detected");
  }

  if ((strategy.counts.PRUNE_REVIEW ?? 0) > (strategy.counts.PROMOTE_PAGE ?? 0) * 2) {
    warnings.push("Strategic degradation trend detected");
  }

  let status: OrchestrationHealthSnapshot["status"] = "HEALTHY";

  if (warnings.length >= 2) status = "WARNING";
  if (warnings.length >= 4) status = "CRITICAL";

  return {
    timestamp: new Date().toISOString(),
    queue,
    performance,
    strategy,
    status,
    warnings,
  };
}
