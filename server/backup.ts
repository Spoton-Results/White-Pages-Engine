import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

const BACKUP_DIR = path.resolve("backups");
const MAX_BACKUPS = 7;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function pruneOldBackups() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("backup_") && f.endsWith(".sql"))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = files.slice(MAX_BACKUPS);
  for (const f of toDelete) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
      console.log(`[backup] Removed old backup: ${f.name}`);
    } catch {
      // non-fatal
    }
  }
}

export async function runBackup(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[backup] DATABASE_URL not set — skipping backup.");
    return;
  }

  ensureBackupDir();

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const filename = `backup_${timestamp}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  console.log(`[backup] Starting daily backup → ${filename}`);
  try {
    await execAsync(
      `pg_dump "${dbUrl}" --no-owner --no-acl --format=plain --file="${filepath}"`
    );
    const sizeKb = Math.round(fs.statSync(filepath).size / 1024);
    console.log(`[backup] Backup complete: ${filename} (${sizeKb} KB)`);
    pruneOldBackups();
  } catch (err: any) {
    console.error("[backup] pg_dump failed:", err.message || err);
    try { fs.unlinkSync(filepath); } catch { /* already gone */ }
  }
}

function msUntilNextRun(hourUTC: number): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUTC, 0, 0, 0)
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function scheduleDailyBackup(hourUTC = 3): void {
  const ms = msUntilNextRun(hourUTC);
  const hh = String(hourUTC).padStart(2, "0");
  console.log(
    `[backup] Daily backup scheduled at ${hh}:00 UTC (next run in ${Math.round(ms / 60000)} min)`
  );

  setTimeout(async () => {
    await runBackup().catch((err) =>
      console.error("[backup] Scheduled backup failed:", err)
    );
    setInterval(async () => {
      await runBackup().catch((err) =>
        console.error("[backup] Scheduled backup failed:", err)
      );
    }, 24 * 60 * 60 * 1000);
  }, ms);
}
