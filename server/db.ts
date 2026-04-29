import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,                          // Replit autoscales to 3+ instances — 15×3=45 total, within DB limits
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,    // 8s — fail fast so requests don't pile up waiting for connections
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});
export const db = drizzle(pool, { schema });
