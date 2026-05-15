import {
  applyRelationshipOpportunities,
  auditRelationshipIntelligence,
} from "../server/services/relationship-intelligence";

async function main() {
  const limit = Number(
    process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 250,
  );

  const apply = process.argv.includes("--apply=true");
  const dryRun = process.argv.includes("--dryRun=true");

  console.log("\n=== RELATIONSHIP INTELLIGENCE ===\n");

  if (apply) {
    const result = await applyRelationshipOpportunities({
      limit,
      dryRun,
    });

    console.log({
      pagesAudited: result.pagesAudited,
      orphanPages: result.orphanPages,
      weakPages: result.weakPages,
      opportunities: result.opportunities.length,
      inserted: result.inserted,
    });
  } else {
    const result = await auditRelationshipIntelligence({
      limit,
      dryRun,
    });

    console.log({
      pagesAudited: result.pagesAudited,
      orphanPages: result.orphanPages,
      weakPages: result.weakPages,
      opportunities: result.opportunities.length,
    });
  }

  console.log("\n=== COMPLETE ===\n");
}

main().catch((err) => {
  console.error("[relationship-intelligence] Fatal:", err);
  process.exitCode = 1;
});
