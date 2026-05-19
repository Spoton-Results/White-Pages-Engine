import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as coreSchema from "@shared/schema";
import * as contentArchitectureSchema from "@shared/content-architecture-schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  // Railway Postgres can take up to 2 minutes to wake from sleep.
  // 8s was too short — the pool would time out and retry in a loop,
  // stalling all requests for the full 3-4 minute cold-start window.
  connectionTimeoutMillis: 120000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

export const schema = {
  ...coreSchema,
  ...contentArchitectureSchema,
};

export const db = drizzle(pool, { schema });

/**
 * Eagerly acquire one connection at boot so Railway DB wakes up
 * before the first real request arrives. Called from server/index.ts
 * boot sequence. Logs clearly instead of silently stalling.
 */
export async function warmupDatabase(): Promise<void> {
  const start = Date.now();
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    const ms = Date.now() - start;
    console.log(`[db] Warmup connected in ${ms}ms`);
  } catch (err: any) {
    console.error(`[db] Warmup failed after ${Date.now() - start}ms:`, err?.message);
  }
}
