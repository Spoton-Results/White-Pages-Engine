import { pool } from "../server/db";

async function main() {
  console.log("[intent-jobs-migrate] Ensuring intent_build_jobs table...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS intent_build_jobs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      website_id VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      status VARCHAR(30) NOT NULL DEFAULT 'queued',
      current_step TEXT,
      progress_percent INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      error_message TEXT,
      result_json JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_intent_build_jobs_website_created ON intent_build_jobs(website_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_intent_build_jobs_status ON intent_build_jobs(status)`);

  console.log("[intent-jobs-migrate] Done.");
}

main()
  .catch((err) => {
    console.error("[intent-jobs-migrate] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
