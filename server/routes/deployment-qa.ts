import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";
import { isR2Configured } from "../services/r2";
import { ensureOperationalLogsTable, getOperationalSummary } from "../services/observability";

const router = Router();
router.use(requireAuth);

type QaStatus = "pass" | "warning" | "fail";

function status(ok: boolean, warning = false): QaStatus {
  if (ok) return "pass";
  return warning ? "warning" : "fail";
}

async function tableExists(tableName: string) {
  const result = await pool.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    [tableName],
  );
  return !!result.rows[0]?.exists;
}

async function countRows(tableName: string) {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
  return result.rows[0]?.count ?? 0;
}

router.get("/api/deployment-qa", async (_req, res, next) => {
  try {
    await ensureOperationalLogsTable();

    const requiredTables = [
      "accounts",
      "websites",
      "pages",
      "services",
      "generation_jobs",
      "internal_links",
      "sitemaps",
      "variation_bank_completeness",
      "content_variation_banks",
      "operational_logs",
      "session",
    ];

    const tableChecks = await Promise.all(requiredTables.map(async (name) => ({ name, exists: await tableExists(name) })));
    const dbPing = await pool.query("SELECT NOW() AS now");
    const summary = await getOperationalSummary();

    const routeMountChecks = [
      { key: "bank_health_routes", label: "Bank Health routes mounted", status: "pass" as QaStatus, detail: "Bank Health router is imported by server startup." },
      { key: "intent_routes", label: "Intent Build routes mounted", status: "pass" as QaStatus, detail: "Intent actions router is mounted through the Bank Health router." },
      { key: "intent_worker", label: "Intent worker scheduled", status: (globalThis as any).__nexusIntentJobWorkerScheduled ? "pass" as QaStatus : "warning" as QaStatus, detail: (globalThis as any).__nexusIntentJobWorkerScheduled ? "Intent job worker scheduler flag is active." : "Worker flag not detected yet in this process." },
    ];

    const envChecks = [
      { key: "database_url", label: "DATABASE_URL", status: status(!!process.env.DATABASE_URL), detail: process.env.DATABASE_URL ? "Configured" : "Missing" },
      { key: "session_secret", label: "SESSION_SECRET", status: status(!!process.env.SESSION_SECRET, true), detail: process.env.SESSION_SECRET ? "Configured" : "Missing; fallback secret is unsafe for production." },
      { key: "node_env", label: "NODE_ENV", status: status(process.env.NODE_ENV === "production", true), detail: `NODE_ENV=${process.env.NODE_ENV || "unset"}` },
      { key: "r2", label: "Cloudflare R2", status: status(isR2Configured(), true), detail: isR2Configured() ? "R2 credentials configured." : "R2 credentials missing or incomplete." },
    ];

    const dbChecks = [
      { key: "db_ping", label: "Database connection", status: "pass" as QaStatus, detail: `Connected at ${dbPing.rows[0]?.now}` },
      ...tableChecks.map(t => ({ key: `table_${t.name}`, label: `Table: ${t.name}`, status: status(t.exists), detail: t.exists ? "Exists" : "Missing" })),
    ];

    const rowCounts = await Promise.all(
      ["accounts", "websites", "pages", "generation_jobs", "operational_logs"].map(async (name) => ({ name, count: await countRows(name) })),
    );

    const opsChecks = [
      { key: "failed_jobs_24h", label: "Failed jobs in last 24h", status: status((summary.failedJobs24h || 0) === 0, (summary.failedJobs24h || 0) > 0), detail: `${summary.failedJobs24h || 0} failed jobs in last 24 hours.` },
      { key: "stuck_jobs", label: "Stuck jobs", status: status((summary.stuckJobs || 0) === 0, (summary.stuckJobs || 0) > 0), detail: `${summary.stuckJobs || 0} pending/running jobs older than 30 minutes.` },
      { key: "error_logs", label: "Operational error logs", status: status(((summary.logsByLevel as any)?.error || 0) === 0, ((summary.logsByLevel as any)?.error || 0) > 0), detail: `${((summary.logsByLevel as any)?.error || 0)} error logs recorded.` },
    ];

    const checks = [...envChecks, ...dbChecks, ...routeMountChecks, ...opsChecks];
    const failCount = checks.filter(c => c.status === "fail").length;
    const warningCount = checks.filter(c => c.status === "warning").length;
    const deploymentStatus = failCount > 0 ? "not_ready" : warningCount > 0 ? "ready_with_warnings" : "ready";

    res.json({
      deploymentStatus,
      checkedAt: new Date().toISOString(),
      environment: {
        nodeEnv: process.env.NODE_ENV || null,
        port: process.env.PORT || null,
        host: process.env.HOST || null,
        r2Configured: isR2Configured(),
      },
      rowCounts: Object.fromEntries(rowCounts.map(r => [r.name, r.count])),
      operationalSummary: summary,
      checks,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
