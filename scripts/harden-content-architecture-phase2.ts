import { pool } from "../server/db";

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [tableName, columnName],
  );
  return result.rowCount > 0;
}

async function addColumnIfMissing(tableName: string, columnName: string, definition: string) {
  if (await columnExists(tableName, columnName)) {
    console.log(`[content-arch:phase2] ${tableName}.${columnName} already exists`);
    return;
  }

  console.log(`[content-arch:phase2] adding ${tableName}.${columnName}`);
  await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

async function indexExists(indexName: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1 LIMIT 1`,
    [indexName],
  );
  return result.rowCount > 0;
}

async function createIndexIfMissing(indexName: string, sql: string) {
  if (await indexExists(indexName)) {
    console.log(`[content-arch:phase2] index ${indexName} already exists`);
    return;
  }

  console.log(`[content-arch:phase2] creating index ${indexName}`);
  await pool.query(sql);
}

async function main() {
  console.log("[content-arch:phase2] Starting hardening migration...");

  await addColumnIfMissing("section_registry", "category", "VARCHAR(80) NOT NULL DEFAULT 'core'");
  await addColumnIfMissing("section_registry", "render_component_key", "VARCHAR(120)");

  await addColumnIfMissing("blueprint_sections", "selection_strategy", "VARCHAR(80) NOT NULL DEFAULT 'best_score'");

  await addColumnIfMissing("variation_generations", "idempotency_key", "VARCHAR(160)");
  await addColumnIfMissing("variation_generations", "retry_of_generation_id", "VARCHAR");
  await addColumnIfMissing("variation_generations", "started_at", "TIMESTAMP");
  await addColumnIfMissing("variation_generations", "completed_at", "TIMESTAMP");

  await addColumnIfMissing("variation_versions", "review_status", "VARCHAR(30) NOT NULL DEFAULT 'approved'");
  await addColumnIfMissing("variation_versions", "source_type", "VARCHAR(40) NOT NULL DEFAULT 'ai_generated'");
  await addColumnIfMissing("variation_versions", "approved_by", "VARCHAR REFERENCES users(id) ON DELETE SET NULL");
  await addColumnIfMissing("variation_versions", "approved_at", "TIMESTAMP");
  await addColumnIfMissing("variation_versions", "rejected_reason", "TEXT");
  await addColumnIfMissing("variation_versions", "score_version", "VARCHAR(60)");
  await addColumnIfMissing("variation_versions", "scored_at", "TIMESTAMP");
  await addColumnIfMissing("variation_versions", "score_inputs", "JSONB NOT NULL DEFAULT '{}'::jsonb");

  await addColumnIfMissing("published_page_sections", "section_key_snapshot", "VARCHAR(100)");
  await addColumnIfMissing("published_page_sections", "rendered_html_snapshot", "TEXT");
  await addColumnIfMissing("published_page_sections", "schema_snapshot", "JSONB");

  await createIndexIfMissing(
    "idx_section_registry_category",
    "CREATE INDEX idx_section_registry_category ON section_registry(category)",
  );
  await createIndexIfMissing(
    "idx_blueprint_sections_strategy",
    "CREATE INDEX idx_blueprint_sections_strategy ON blueprint_sections(selection_strategy)",
  );
  await createIndexIfMissing(
    "idx_variation_versions_review_status",
    "CREATE INDEX idx_variation_versions_review_status ON variation_versions(review_status)",
  );
  await createIndexIfMissing(
    "idx_variation_versions_source_type",
    "CREATE INDEX idx_variation_versions_source_type ON variation_versions(source_type)",
  );
  await createIndexIfMissing(
    "idx_published_page_sections_key_snapshot",
    "CREATE INDEX idx_published_page_sections_key_snapshot ON published_page_sections(section_key_snapshot)",
  );

  console.log("[content-arch:phase2] Hardening migration complete.");
}

main()
  .catch((err) => {
    console.error("[content-arch:phase2] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
