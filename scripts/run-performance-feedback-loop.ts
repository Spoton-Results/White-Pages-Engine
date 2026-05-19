import {
  getPerformanceFeedbackSummary,
  runPerformanceFeedbackLoop,
} from "../server/services/performance-feedback-loop";

async function main() {
  const limit = Number(
    process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 250,
  );

  const summaryOnly = process.argv.includes("--summary=true");
  const dryRun = process.argv.includes("--dryRun=true");

  console.log("\n=== PERFORMANCE FEEDBACK LOOP ===\n");

  if (summaryOnly) {
    const summary = await getPerformanceFeedbackSummary();
    console.log(summary);
  } else {
    const result = await runPerformanceFeedbackLoop({
      limit,
      dryRun,
    });

    console.log({
      audited: result.audited,
      promote: result.promote,
      refresh: result.refresh,
      improveCtr: result.improveCtr,
      pruneReview: result.pruneReview,
      wait: result.wait,
    });
  }

  console.log("\n=== COMPLETE ===\n");
}

main().catch((err) => {
  console.error("[performance-feedback-loop] Fatal:", err);
  process.exitCode = 1;
});
