import { runContinuousOrchestration } from "../server/services/continuous-orchestration-engine";

async function main() {
  const cycles = Number(
    process.argv.find((arg) => arg.startsWith("--cycles="))?.split("=")[1] ?? 1,
  );

  const dryRun = process.argv.includes("--dryRun=true");
  const allowExecution = process.argv.includes("--allowExecution=true");
  const allowPrune = process.argv.includes("--allowPrune=true");
  const allowLinkApply = process.argv.includes("--allowLinkApply=true");

  console.log("\n=== CONTINUOUS ORCHESTRATION ENGINE ===\n");

  const result = await runContinuousOrchestration({
    cycles,
    dryRun,
    allowExecution,
    allowPrune,
    allowLinkApply,
  });

  console.log({
    cyclesRequested: result.cyclesRequested,
    cyclesCompleted: result.cyclesCompleted,
    executionEnabled: result.executionEnabled,
    dryRun: result.dryRun,
    latestCycle: result.results[result.results.length - 1],
  });

  console.log("\n=== COMPLETE ===\n");
}

main().catch((err) => {
  console.error("[continuous-orchestration] Fatal:", err);
  process.exitCode = 1;
});
