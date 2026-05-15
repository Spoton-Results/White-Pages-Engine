import { db } from "../server/db";
import {
  blueprintSections,
  sectionRegistry,
  variationGenerations,
  variationVersions,
} from "@shared/content-architecture-schema";
import { sql } from "drizzle-orm";

async function assertCount(name: string, count: number, min = 0) {
  if (count < min) {
    throw new Error(`[smoke-content-architecture] ${name} below expected minimum ${min}`);
  }

  console.log(`✓ ${name}: ${count}`);
}

async function main() {
  console.log("\n=== CONTENT ARCHITECTURE SMOKE TEST ===\n");

  const sectionCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sectionRegistry);

  const blueprintCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(blueprintSections);

  const generationCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationGenerations);

  const versionCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(variationVersions);

  await assertCount("Registered sections", sectionCount[0]?.count ?? 0, 8);
  await assertCount("Blueprint sections", blueprintCount[0]?.count ?? 0, 0);
  await assertCount("Variation generations", generationCount[0]?.count ?? 0, 0);
  await assertCount("Variation versions", versionCount[0]?.count ?? 0, 0);

  console.log("\n=== SMOKE TEST PASSED ===\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
