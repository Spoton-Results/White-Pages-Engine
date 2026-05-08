import { pool } from "../db";

type LogLevel = "info" | "warning" | "error";

export async function ensureOperationalLogsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operational_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      website_id UUID,
      account_id UUID,
      job_id UUID,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_operational_logs_created_at ON operational_logs(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_operational_logs_website_id ON operational_logs(website_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_operational_logs_level ON operational_logs(level)`);
}

export async function logOperationalEvent(input: {
  level: LogLevel;
  source: string;
  message: string;
  websiteId?: string | null;
  accountId?: string | null;
  jobId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await ensureOperationalLogsTable();
    await pool.query(
      `INSERT INTO operational_logs (level, source, message, website_id, account_id, job_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [input.level, input.source, input.message, input.websiteId || null, input.accountId || null, input.jobId || null, JSON.stringify(input.metadata || {})],
    );
  } catch (err) {
    console.error("[observability] failed to write operational log:", err);
  }
}

export async function getOperationalSummary(websiteId?: string) {
  await ensureOperationalLogsTable();
  const params: any[] = [];
  const where = websiteId ? "WHERE website_id = $1" : "";
  if (websiteId) params.push(websiteId);

  const [levels, stuckJobs, recentFailures] = await Promise.all([
    pool.query(
      `SELECT level, COUNT(*)::int AS count FROM operational_logs ${where} GROUP BY level`,
      params,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM generation_jobs
       WHERE status IN ('pending', 'running')
         AND created_at < NOW() - INTERVAL '30 minutes'
         ${websiteId ? "AND website_id = $1" : ""}`,
      params,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM generation_jobs
       WHERE status = 'failed'
         AND created_at > NOW() - INTERVAL '24 hours'
         ${websiteId ? "AND website_id = $1" : ""}`,
      params,
    ),
  ]);

  return {
    logsByLevel: Object.fromEntries(levels.rows.map((r: any) => [r.level, r.count])),
    stuckJobs: stuckJobs.rows[0]?.count ?? 0,
    failedJobs24h: recentFailures.rows[0]?.count ?? 0,
  };
}
