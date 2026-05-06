import { pool } from "../server/db";

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1::text
       AND column_name = $2::text
     LIMIT 1`,
    [tableName, columnName],
  );
  return result.rowCount > 0;
}

async function addColumnIfMissing(tableName: string, columnName: string, definition: string) {
  const exists = await columnExists(tableName, columnName);
  if (exists) {
    console.log(`[intent-migrate] ${tableName}.${columnName} already exists`);
    return;
  }

  console.log(`[intent-migrate] adding ${tableName}.${columnName}`);
  await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

async function createIndexIfMissing(indexName: string, sql: string) {
  const result = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1::text LIMIT 1`,
    [indexName],
  );

  if (result.rowCount > 0) {
    console.log(`[intent-migrate] index ${indexName} already exists`);
    return;
  }

  console.log(`[intent-migrate] creating index ${indexName}`);
  await pool.query(sql);
}

async function main() {
  console.log("[intent-migrate] Starting Intent Ownership Phase 1 migration...");

  await addColumnIfMissing("pages", "primary_intent", "TEXT");
  await addColumnIfMissing("pages", "secondary_intent", "TEXT");
  await addColumnIfMissing("pages", "intent_family", "TEXT");
  await addColumnIfMissing("pages", "funnel_stage", "TEXT");
  await addColumnIfMissing("pages", "canonical_owner", "BOOLEAN NOT NULL DEFAULT false");
  await addColumnIfMissing("pages", "parent_intent_page_id", "VARCHAR");
  await addColumnIfMissing("pages", "overlap_risk", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("pages", "semantic_distance", "NUMERIC(5,2)");
  await addColumnIfMissing("pages", "authority_weight", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("pages", "intent_cluster", "TEXT");
  await addColumnIfMissing("pages", "support_role", "TEXT");
  await addColumnIfMissing("pages", "cannibalization_risk", "TEXT NOT NULL DEFAULT 'LOW'");
  await addColumnIfMissing("pages", "intent_last_evaluated_at", "TIMESTAMP");

  await createIndexIfMissing(
    "idx_pages_intent_cluster",
    "CREATE INDEX idx_pages_intent_cluster ON pages (website_id, intent_cluster)",
  );
  await createIndexIfMissing(
    "idx_pages_primary_intent",
    "CREATE INDEX idx_pages_primary_intent ON pages (website_id, primary_intent)",
  );
  await createIndexIfMissing(
    "idx_pages_canonical_owner",
    "CREATE INDEX idx_pages_canonical_owner ON pages (website_id, canonical_owner)",
  );
  await createIndexIfMissing(
    "idx_pages_cannibalization_risk",
    "CREATE INDEX idx_pages_cannibalization_risk ON pages (website_id, cannibalization_risk)",
  );

  console.log("[intent-migrate] Done.");
}

main()
  .catch((err) => {
    console.error("[intent-migrate] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
