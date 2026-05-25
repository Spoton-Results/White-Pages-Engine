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
  // Railway can briefly stall Postgres connections during deploy/cold-starts.
  // The app has many feature tabs that poll at the same time, so 5 slots was
  // too tight and caused "timeout exceeded when trying to connect" during
  // variation-bank writes and startup migrations. Keep this moderate so we do
  // not overload Postgres, but give concurrent UI/API requests room to breathe.
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  // Give Postgres enough time to hand back a client during deploy/startup.
  // Request handlers still catch and return JSON errors; this avoids false
  // negatives while Railway is warming DB/network connections.
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 30000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Prevent unhandled 'error' events from crashing the process when a
// background pool client loses its connection (e.g. Railway DB restart).
pool.on("error", (err) => {
  console.error("[db] Pool background client error (non-fatal):", err.message);
});

export const schema = {
  ...coreSchema,
  ...contentArchitectureSchema,
};

export const db = drizzle(pool, { schema });

/**
 * Non-blocking DB warmup with exponential backoff retry.
 * Fires-and-forgets — never blocks the HTTP server from starting.
 * Retries up to 8 times (total ~4 minutes) so Railway DB cold-starts
 * are handled gracefully without freezing the request pool.
 */
export function warmupDatabase(): void {
  const MAX_ATTEMPTS = 8;
  const BASE_DELAY_MS = 3000;

  async function attempt(n: number): Promise<void> {
    const start = Date.now();
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log(`[db] Warmup connected in ${Date.now() - start}ms (attempt ${n})`);
    } catch (err: any) {
      const elapsed = Date.now() - start;
      if (n >= MAX_ATTEMPTS) {
        console.error(`[db] Warmup giving up after ${n} attempts (${elapsed}ms): ${err?.message}`);
        return;
      }
      const delay = BASE_DELAY_MS * Math.pow(1.8, n - 1);
      console.warn(`[db] Warmup attempt ${n} failed (${elapsed}ms): ${err?.message} — retrying in ${Math.round(delay / 1000)}s`);
      setTimeout(() => attempt(n + 1), delay);
    }
  }

  // Fire without awaiting — never blocks server boot or request handling
  attempt(1);
}
