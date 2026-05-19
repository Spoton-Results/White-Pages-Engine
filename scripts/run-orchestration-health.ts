import { getOrchestrationHealthSnapshot } from "../server/services/orchestration-observability";

async function main() {
  console.log("\n=== ORCHESTRATION HEALTH ===\n");

  const snapshot = await getOrchestrationHealthSnapshot();

  console.log(JSON.stringify(snapshot, null, 2));

  console.log("\n=== COMPLETE ===\n");
}

main().catch((err) => {
  console.error("[orchestration-health] Fatal:", err);
  process.exitCode = 1;
});
