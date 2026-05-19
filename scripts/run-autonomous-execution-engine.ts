import { runAutonomousExecutionEngine } from "../server/services/autonomous-execution-engine";

async function main() {
  const limit = Number(
    process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 250,
  );

  const dryRun = process.argv.includes("--dryRun=true");
  const allowPrune = process.argv.includes("--allowPrune=true");
  const allowLinkApply = process.argv.includes("--allowLinkApply=true");

  console.log("\n=== AUTONOMOUS EXECUTION ENGINE ===\n");

  const result = await runAutonomousExecutionEngine({
    limit,
    dryRun,
    allowPrune,
    allowLinkApply,
  });

  console.log({
    planned: result.planned,
    executed: result.executed,
    skipped: result.skipped,
    failed: result.failed,
    topTasks: result.tasks.slice(0, 10),
  });

  console.log("\n=== COMPLETE ===\n");
}

main().catch((err) => {
  console.error("[autonomous-execution-engine] Fatal:", err);
  process.exitCode = 1;
});
