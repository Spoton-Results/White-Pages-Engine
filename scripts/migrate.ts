import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../server/db";

async function main() {
  console.log("[migrate] Running pending migrations...");
  await migrate(db, { migrationsFolder: "./migrations" });
  console.log("[migrate] All migrations applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] Migration failed:", err);
  process.exit(1);
});
