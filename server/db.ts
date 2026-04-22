import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 60,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,   // fail fast — don't queue forever
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});
export const db = drizzle(pool, { schema });
