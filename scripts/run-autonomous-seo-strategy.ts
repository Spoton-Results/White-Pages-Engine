import {
  getAutonomousStrategySummary,
  runAutonomousSeoStrategy,
} from "../server/services/autonomous-seo-strategy";

async function main() {
  const limit = Number(
    process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 250,
  );

  const summaryOnly = process.argv.includes("--summary=true");
  const dryRun = process.argv.includes("--dryRun=true");

  console.log("\n=== AUTONOMOUS SEO STRATEGY ===\n");

  if (summaryOnly) {
    const summary = await getAutonomousStrategySummary();
    console.log(summary);
  } else {
    const result = await runAutonomousSeoStrategy({
      limit,
      dryRun,
    });

    console.log({
      actions: result.actions.length,
      counts: result.counts,
      topActions: result.actions.slice(0, 10),
    });
  }

  console.log("\n=== COMPLETE ===\n");
}

main().catch((err) => {
  console.error("[autonomous-seo-strategy] Fatal:", err);
  process.exitCode = 1;
});
