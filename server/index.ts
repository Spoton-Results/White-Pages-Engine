import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";

const app = express();
const httpServer = createServer(app);

// Trust Replit's reverse proxy so secure cookies and req.secure work correctly
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).substring(0, 200)}`;
      }
      log(logLine);
    }
  });

  next();
});

async function runBackgroundStartup() {
  // Run safe schema migrations (idempotent). Parallelised for speed:
  //   • Batch ALTER TABLE per table (one round-trip per table instead of one per column)
  //   • Run CREATE TABLE + CREATE INDEX groups in parallel
  try {
    const { pool: pgPool, db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const exec = (stmt: string) => pgPool.query(stmt).catch(() => {});

    // ── Batch 1: ALTER TABLE — one statement per table (parallel across tables) ──
    await Promise.all([
      exec(`ALTER TABLE sitemaps
              ADD COLUMN IF NOT EXISTS xml_content TEXT`),
      exec(`ALTER TABLE pages
              ADD COLUMN IF NOT EXISTS gsc_submitted_at       TIMESTAMP,
              ADD COLUMN IF NOT EXISTS duplicate_flag          BOOLEAN     DEFAULT false,
              ADD COLUMN IF NOT EXISTS duplicate_of_slug       VARCHAR(500),
              ADD COLUMN IF NOT EXISTS duplicate_similarity     DECIMAL(5,4),
              ADD COLUMN IF NOT EXISTS trust_score             INTEGER,
              ADD COLUMN IF NOT EXISTS evidence_score          INTEGER,
              ADD COLUMN IF NOT EXISTS content_quality_score   INTEGER`),
      exec(`ALTER TABLE websites
              ADD COLUMN IF NOT EXISTS protection_mode        BOOLEAN DEFAULT false,
              ADD COLUMN IF NOT EXISTS protection_expires_at  TIMESTAMP,
              ADD COLUMN IF NOT EXISTS warmup_day             INTEGER DEFAULT 0,
              ADD COLUMN IF NOT EXISTS warmup_page_cap_override INTEGER`),
      exec(`ALTER TABLE onboarding_submissions
              ADD COLUMN IF NOT EXISTS governor_results   JSONB,
              ADD COLUMN IF NOT EXISTS brand_input_score  INTEGER,
              ADD COLUMN IF NOT EXISTS brand_input_result JSONB,
              ADD COLUMN IF NOT EXISTS gap_report         JSONB`),
      exec(`ALTER TABLE accounts
              ADD COLUMN IF NOT EXISTS monthly_seo_spend NUMERIC(10,2) DEFAULT 0`),
    ]);
    console.log("[startup] Schema migrations: ALTER TABLE columns ensured.");

    // ── Batch 2: CREATE TABLE — all in parallel ────────────────────────────────
    await Promise.all([
      exec(`CREATE TABLE IF NOT EXISTS launch_health_scores (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id varchar NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
        score integer DEFAULT 0, max_score integer DEFAULT 100,
        breakdown jsonb, calculated_at timestamp DEFAULT NOW()
      )`),
      exec(`CREATE TABLE IF NOT EXISTS client_weekly_digests (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id varchar NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
        account_id varchar NOT NULL, recipient_email varchar(255) NOT NULL,
        subject varchar(500), body_html text, body_text text,
        sent_at timestamp, created_at timestamp DEFAULT NOW(), status varchar(20) DEFAULT 'pending'
      )`),
      exec(`CREATE TABLE IF NOT EXISTS call_tracking_numbers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
        page_id VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        service_id VARCHAR NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        location_id VARCHAR REFERENCES locations(id) ON DELETE SET NULL,
        dynamic_number VARCHAR(20) NOT NULL UNIQUE,
        forward_to_number VARCHAR(20) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`),
      exec(`CREATE TABLE IF NOT EXISTS tracked_calls (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
        page_id VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        service_id VARCHAR NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        location_id VARCHAR REFERENCES locations(id) ON DELETE SET NULL,
        dynamic_number VARCHAR(20) NOT NULL, caller_phone_hash VARCHAR(255),
        call_duration_seconds INT, call_timestamp TIMESTAMP NOT NULL,
        call_status VARCHAR(50), call_provider_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )`),
      exec(`CREATE TABLE IF NOT EXISTS tracked_leads (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
        page_id VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        service_id VARCHAR NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        location_id VARCHAR REFERENCES locations(id) ON DELETE SET NULL,
        form_name VARCHAR(255), submitter_name VARCHAR(255),
        submitter_email VARCHAR(255), submitter_phone VARCHAR(20),
        message TEXT, source_page_url TEXT, source_page_title VARCHAR(255),
        form_timestamp TIMESTAMP NOT NULL, created_at TIMESTAMP DEFAULT NOW()
      )`),
      exec(`CREATE TABLE IF NOT EXISTS booked_jobs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id VARCHAR REFERENCES tracked_leads(id) ON DELETE SET NULL,
        website_id VARCHAR NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
        page_id VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        account_id VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        job_value DECIMAL(10,2), booked_date TIMESTAMP NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`),
      exec(`CREATE TABLE IF NOT EXISTS admin_notifications (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id varchar NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
        type text NOT NULL, title text NOT NULL, message text NOT NULL,
        metadata jsonb, read_at timestamp, created_at timestamp NOT NULL DEFAULT NOW()
      )`),
      exec(`CREATE TABLE IF NOT EXISTS demotion_logs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id varchar NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
        page_id varchar NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        from_tier integer NOT NULL, to_tier integer NOT NULL,
        reason text NOT NULL, created_at timestamp NOT NULL DEFAULT NOW()
      )`),
      exec(`CREATE TABLE IF NOT EXISTS api_usage_log (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id VARCHAR REFERENCES accounts(id) ON DELETE SET NULL,
        website_id VARCHAR REFERENCES websites(id) ON DELETE SET NULL,
        generation_type VARCHAR(100) NOT NULL,
        model_used VARCHAR(100) NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`),
    ]);
    console.log("[startup] Schema migrations: CREATE TABLE ensured.");

    // ── Batch 3: CREATE INDEX — all in parallel ────────────────────────────────
    await Promise.all([
      `CREATE INDEX IF NOT EXISTS idx_pages_website_slug       ON pages(website_id, slug)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_website_status     ON pages(website_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_status             ON pages(status)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_updated_at         ON pages(updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_website_id         ON pages(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_duplicate_flag     ON pages(website_id, duplicate_flag)`,
      `CREATE INDEX IF NOT EXISTS idx_page_versions_page_id    ON page_versions(page_id)`,
      `CREATE INDEX IF NOT EXISTS idx_page_versions_active     ON page_versions(page_id, is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_websites_account_id      ON websites(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_websites_protection_mode ON websites(protection_mode)`,
      `CREATE INDEX IF NOT EXISTS idx_users_account_id         ON users(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_locations_account_id     ON locations(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_services_account_id      ON services(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_blueprints_account_id    ON blueprints(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_blueprints_website_id    ON blueprints(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_pages_account_id     ON hub_pages(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_pages_website_id     ON hub_pages(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_generation_jobs_account_id ON generation_jobs(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_generation_jobs_website_id ON generation_jobs(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sitemaps_website_id      ON sitemaps(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_query_clusters_account_id ON query_clusters(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_internal_links_website_id ON internal_links(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_accounts_agency_id       ON accounts(agency_id)`,
      `CREATE INDEX IF NOT EXISTS idx_launch_health_website    ON launch_health_scores(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_launch_health_date       ON launch_health_scores(calculated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_client_digest_website    ON client_weekly_digests(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_client_digest_status     ON client_weekly_digests(status)`,
      `CREATE INDEX IF NOT EXISTS idx_call_tracking_page       ON call_tracking_numbers(page_id)`,
      `CREATE INDEX IF NOT EXISTS idx_call_tracking_website    ON call_tracking_numbers(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tracked_calls_page       ON tracked_calls(page_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tracked_calls_timestamp  ON tracked_calls(call_timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_tracked_calls_website    ON tracked_calls(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tracked_leads_page       ON tracked_leads(page_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tracked_leads_website    ON tracked_leads(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tracked_leads_timestamp  ON tracked_leads(form_timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_booked_jobs_account      ON booked_jobs(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_booked_jobs_page         ON booked_jobs(page_id)`,
      `CREATE INDEX IF NOT EXISTS idx_booked_jobs_date         ON booked_jobs(booked_date)`,
      `CREATE INDEX IF NOT EXISTS idx_admin_notif_website      ON admin_notifications(website_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_demotion_logs_website    ON demotion_logs(website_id, created_at DESC)`,
      // Unique constraints moved out of Drizzle schema to avoid interactive db:push prompts
      // during deployment (DB had _key suffix, Drizzle expects _unique — name mismatch).
      `CREATE UNIQUE INDEX IF NOT EXISTS state_data_state_abbr_unique              ON state_data(state_abbr)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS call_tracking_numbers_dynamic_number_unique ON call_tracking_numbers(dynamic_number)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS onboarding_submissions_token_unique        ON onboarding_submissions(token)`,
      // ── Partial indexes for published pages (billions-scale) ──────────────────
      // Partial indexes skip non-published rows entirely — ~10-100x smaller than full indexes.
      // Critical for COUNT, tier-filtering, scoring, and sitemap queries on large datasets.
      `CREATE INDEX IF NOT EXISTS idx_pages_pub_tier
         ON pages(website_id, tier)
         WHERE status = 'published'`,
      `CREATE INDEX IF NOT EXISTS idx_pages_pub_quality
         ON pages(website_id, quality_score)
         WHERE status = 'published' AND quality_score IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_pages_pub_updated
         ON pages(website_id, updated_at DESC)
         WHERE status = 'published'`,
      `CREATE INDEX IF NOT EXISTS idx_pages_pub_slug
         ON pages(website_id, slug)
         WHERE status = 'published'`,
      `CREATE INDEX IF NOT EXISTS idx_pages_website_slug      ON pages(website_id, slug)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_website_updated   ON pages(website_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_gsc_submitted     ON pages(website_id, gsc_submitted_at)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_publish_wave      ON pages(website_id, publish_wave)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_website_created   ON pages(website_id, created_at)`,
    ].map(exec));
    console.log("[startup] Database indexes ensured.");

    // ── Incremental publishedPages counter trigger ─────────────────────────────
    // Maintains websites.published_pages automatically on page INSERT/UPDATE/DELETE.
    // Eliminates full COUNT(*) scans which become painfully slow at billions of rows.
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION fn_sync_published_pages_count()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.status = 'published' THEN
            UPDATE websites
              SET published_pages = GREATEST(0, COALESCE(published_pages, 0) + 1)
              WHERE id = NEW.website_id;
          END IF;
        ELSIF TG_OP = 'UPDATE' THEN
          IF OLD.status IS DISTINCT FROM NEW.status THEN
            IF NEW.status = 'published' THEN
              UPDATE websites
                SET published_pages = GREATEST(0, COALESCE(published_pages, 0) + 1)
                WHERE id = NEW.website_id;
            ELSIF OLD.status = 'published' THEN
              UPDATE websites
                SET published_pages = GREATEST(0, COALESCE(published_pages, 0) - 1)
                WHERE id = OLD.website_id;
            END IF;
          END IF;
        ELSIF TG_OP = 'DELETE' THEN
          IF OLD.status = 'published' THEN
            UPDATE websites
              SET published_pages = GREATEST(0, COALESCE(published_pages, 0) - 1)
              WHERE id = OLD.website_id;
          END IF;
        END IF;
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(sql`
      DROP TRIGGER IF EXISTS trg_sync_published_pages ON pages;
    `);
    await db.execute(sql`
      CREATE TRIGGER trg_sync_published_pages
        AFTER INSERT OR UPDATE OF status OR DELETE ON pages
        FOR EACH ROW EXECUTE FUNCTION fn_sync_published_pages_count();
    `);
    console.log("[startup] Published-pages counter trigger installed.");

    // Domain migration: update old subdomain-based domains to root domain + /pages proxyPath
    await db.execute(sql`
      UPDATE websites
      SET domain = 'spotonresults.com',
          name   = CASE WHEN name = 'SpotOn Results Main' THEN 'SpotOn Results' ELSE name END,
          settings = settings || '{"proxyPath":"/pages","parentDomain":"spotonresults.com"}'::jsonb
      WHERE domain = 'pages.spotonresults.com'
    `);
    // ── pages.subdraw.com — SEO white-label pages only ─────────────────────────
    // Moves all pages from any old subdraw.com / subtrackers records → pages.subdraw.com
    // This is idempotent: safe to run on every boot.

    // Step A: Ensure pages.subdraw.com record exists first
    await db.execute(sql`
      INSERT INTO websites (id, domain, name, account_id, settings, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        'pages.subdraw.com',
        'Subdraw',
        '70ec4b1c-80b2-4c17-9d22-f63275d21310',
        '{"proxyPath":"","parentDomain":"pages.subdraw.com","primaryColor":"#1e40af"}'::jsonb,
        NOW(), NOW()
      )
      ON CONFLICT (domain) DO NOTHING
    `);

    // Step B: Reassign all pages from old domain records → pages.subdraw.com
    await db.execute(sql`
      UPDATE pages
      SET website_id = (SELECT id FROM websites WHERE domain = 'pages.subdraw.com')
      WHERE website_id IN (
        SELECT id FROM websites
        WHERE domain IN ('subdraw.com','subtrackers.spotonresults.com','pagessubtrackers.spotonresults.com')
      )
    `);

    // Step C: Delete the now-empty old domain records
    await db.execute(sql`
      DELETE FROM websites
      WHERE domain IN ('subdraw.com','subtrackers.spotonresults.com','pagessubtrackers.spotonresults.com')
    `);

    // Step D: Always ensure correct settings on pages.subdraw.com
    await db.execute(sql`
      UPDATE websites
      SET settings = (settings
        || '{"proxyPath":"","parentDomain":"pages.subdraw.com","primaryColor":"#1e40af"}'::jsonb)
        - 'mainWebsiteUrl'
      WHERE domain = 'pages.subdraw.com'
    `);
    console.log("[startup] pages.subdraw.com: all pages migrated, old subdraw.com records removed (idempotent).");

    // Data patch: fix "State, State" duplicate in state_hub page titles/H1s.
    // Caused by blueprint templates using {city}, {state} applied to state-level targets
    // where location === state name (e.g. "New Mexico, New Mexico" → "New Mexico").
    // Uses string ops (no backreference regex): extracts the state name from the h1, then
    // removes the trailing ", StateName" from h1 and ", StateName | " from title.
    // This patch is idempotent — pages without the pattern are unaffected by the LIKE filter.
    const patch = await db.execute(sql`
      UPDATE pages
      SET
        h1    = replace(h1,    ', ' || split_part(split_part(h1, ' in ', 2), ', ', 1), ''),
        title = replace(title, ', ' || split_part(split_part(h1, ' in ', 2), ', ', 1) || ' | ', ' | ')
      WHERE page_type = 'state_hub'
        AND h1 LIKE '% in %, %'
    `);
    const patched = (patch as any).rowCount ?? 0;
    if (patched > 0) {
      console.log(`[startup] Data patch: fixed ${patched} state_hub pages with duplicate "State, State" in title/H1.`);
    }
  } catch (err) {
    console.error("[startup] Schema migration failed (non-fatal):", err);
  }

  // Seed database
  try {
    await seedDatabase();
  } catch (err) {
    console.error("Seeding failed (non-fatal):", err);
  }

  // Sync ALL website published-page counters — runs 5 min after boot so page serving
  // gets all DB connections first. COUNT(*) on 3.8M rows is slow; don't block startup.
  setTimeout(async () => {
    try {
      const { getWebsites, syncWebsitePublishedCount } = await import("./storage");
      const allWebsites = await getWebsites();
      if (allWebsites.length > 0) {
        console.log(`[startup] Syncing published-page counts for ${allWebsites.length} website(s)...`);
        // Serialize to avoid stacking heavy COUNT queries on the pool simultaneously
        for (const w of allWebsites) {
          await syncWebsitePublishedCount(w.id).catch(() => {});
        }
        console.log("[startup] Page count sync complete.");
      }
    } catch (err) {
      console.error("[startup] Page count sync failed (non-fatal):", err);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // NOTE: startup tier assignment removed — running bulkUpdatePageTiers on 3.8M rows
  // at boot holds DB connections for 3+ minutes and causes page serving timeouts.
  // Tier assignment runs via the normal scoring/automation pipeline instead.

  // Resume any background jobs that were interrupted by a server restart
  try {
    const { getStaleRunningJobs, updateGenerationJob } = await import("./storage");
    const { runBulkBackgroundJob } = await import("./services/bulk-background");
    const { runBankWriteJob } = await import("./services/bank-write-background");
    const stale = await getStaleRunningJobs();

    const bulkJobs = stale.filter(j => Array.isArray((j.settings as any)?.services));
    if (bulkJobs.length > 0) {
      console.log(`[startup] Resuming ${bulkJobs.length} interrupted bulk job(s)...`);
      for (const j of bulkJobs) {
        // Death-spiral guard: if this job has been interrupted many times or crashed very recently,
        // it is likely causing OOM on every restart. Cancel it rather than re-entering the loop.
        const settings = j.settings as any;
        const interruptCount = (settings._interruptCount ?? 0) + 1;
        const newSettings = { ...settings, _interruptCount: interruptCount };

        const startedAt = j.startedAt ? new Date(j.startedAt).getTime() : 0;
        const minutesSinceStart = startedAt ? (Date.now() - startedAt) / 60_000 : Infinity;
        const isCrashLoop = interruptCount > 4 || minutesSinceStart < 5;

        if (isCrashLoop) {
          console.warn(`[startup] Job ${j.id} is in a crash loop (restarted ${interruptCount}x, last crash ${minutesSinceStart.toFixed(1)} min ago) — auto-cancelling to prevent OOM`);
          await updateGenerationJob(j.id, { status: "cancelled", completedAt: new Date(), settings: newSettings as any });
          continue;
        }

        await updateGenerationJob(j.id, { status: "pending", startedAt: null, settings: newSettings as any });
        setImmediate(() => {
          runBulkBackgroundJob(j.id).catch(err => {
            console.error("[startup] Failed to resume bulk job", j.id, err);
            updateGenerationJob(j.id, { status: "error", completedAt: new Date() }).catch(() => {});
          });
        });
      }
    }

    const bankJobs = stale.filter(j => (j.settings as any)?.type === "bank_write");
    if (bankJobs.length > 0) {
      console.log(`[startup] Resuming ${bankJobs.length} interrupted bank-write job(s)...`);
      for (const j of bankJobs) {
        const settings = j.settings as any;
        if (Array.isArray(settings?.progress)) {
          settings.progress = settings.progress.map((p: any) =>
            p.status === "running" ? { ...p, status: "pending" } : p,
          );
        }
        await updateGenerationJob(j.id, { status: "pending", startedAt: null, settings });
        setImmediate(() => {
          runBankWriteJob(j.id).catch(err => {
            console.error("[startup] Failed to resume bank-write job", j.id, err);
            updateGenerationJob(j.id, { status: "error", completedAt: new Date() }).catch(() => {});
          });
        });
      }
    }
  } catch (err) {
    console.error("[startup] Job recovery failed (non-fatal):", err);
  }
}

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      // Run all heavy startup tasks in the background after the port is open
      setImmediate(() => {
        runBackgroundStartup().catch(err => {
          console.error("[startup] Background startup failed (non-fatal):", err);
        });
      });

      // Sitemap startup task — warm cache then one-time regen for any missing xml_content
      setImmediate(async () => {
        try {
          const { getWebsites, getSitemaps } = await import("./storage");
          const { warmSitemapCache } = await import("./routes");
          const { generateSitemapsForWebsite } = await import("./services/sitemap");
          const allWebsites = await getWebsites();
          const withPages = allWebsites.filter(w => w.publishedPageCount && w.publishedPageCount > 0);
          if (withPages.length === 0) return;

          console.log(`[startup] Sitemap startup task for ${withPages.length} website(s)...`);

          await Promise.all(withPages.map(async (w) => {
            try {
              await warmSitemapCache(w.id);
              const chunks = await getSitemaps(w.id);
              const needsRegen = chunks.length > 0 && chunks.some(c => !c.xmlContent);
              if (needsRegen) {
                console.log(`[startup] Running one-time sitemap regen for ${w.domain} (${chunks.length} chunk(s) missing xml_content)...`);
                await generateSitemapsForWebsite(w.id, w.domain);
                console.log(`[startup] Sitemap regen complete for ${w.domain}`);
              }
            } catch (err) {
              console.error(`[startup] Sitemap task failed for ${w.domain} (non-fatal):`, err);
            }
          }));

          console.log("[startup] Sitemap startup task complete.");
        } catch (err) {
          console.error("[startup] Sitemap startup task failed (non-fatal):", err);
        }
      });

      // Daily database backup — runs at 03:00 UTC, keeps last 7 files
      setImmediate(async () => {
        try {
          const { scheduleDailyBackup } = await import("./backup");
          scheduleDailyBackup(3);
        } catch (err) {
          console.error("[backup] Failed to schedule daily backup (non-fatal):", err);
        }
      });

      // Auto 6: Weekly auto-demote — run once 5 min after startup, then every 7 days
      setTimeout(async () => {
        try {
          const { runWeeklyAutoDemoteWithJobs } = await import("./services/automation");
          await runWeeklyAutoDemoteWithJobs();
        } catch (err) {
          console.error("[auto6] Initial auto-demote run failed (non-fatal):", err);
        }
        setInterval(async () => {
          try {
            const { runWeeklyAutoDemoteWithJobs } = await import("./services/automation");
            await runWeeklyAutoDemoteWithJobs();
          } catch (err) {
            console.error("[auto6] Scheduled auto-demote failed (non-fatal):", err);
          }
        }, 7 * 24 * 60 * 60 * 1000);
      }, 5 * 60 * 1000);

      // Phase 7: Daily wave readiness check — unlocks Wave 2+ on 14-day cadence
      setTimeout(async () => {
        try {
          const { runDailyWaveCheck } = await import("./services/launch-governors");
          await runDailyWaveCheck();
        } catch (err) {
          console.error("[Wave Unlock] Initial wave check failed (non-fatal):", err);
        }
        setInterval(async () => {
          try {
            const { runDailyWaveCheck } = await import("./services/launch-governors");
            await runDailyWaveCheck();
          } catch (err) {
            console.error("[Wave Unlock] Scheduled wave check failed (non-fatal):", err);
          }
        }, 24 * 60 * 60 * 1000);
      }, 10 * 60 * 1000);

      // Auto 8: Weekly summary email — check every hour, send on Monday mornings (UTC)
      setInterval(async () => {
        const now = new Date();
        if (now.getUTCDay() === 1 && now.getUTCHours() === 8 && now.getUTCMinutes() < 60) {
          try {
            const { sendWeeklySummaryEmails } = await import("./services/automation");
            await sendWeeklySummaryEmails();
          } catch (err) {
            console.error("[auto8] Weekly email failed (non-fatal):", err);
          }
        }
      }, 60 * 60 * 1000);

      // Phase 9: Weekly Launch Health calculation — Monday 06:00 UTC
      setInterval(async () => {
        const now = new Date();
        if (now.getUTCDay() === 1 && now.getUTCHours() === 6 && now.getUTCMinutes() < 60) {
          try {
            const { runWeeklyLaunchHealth } = await import("./services/launch-health");
            await runWeeklyLaunchHealth();
          } catch (err) {
            console.error("[Launch Health] Weekly run failed (non-fatal):", err);
          }
        }
      }, 60 * 60 * 1000);

      // Phase 9: Weekly Client Digest — Monday 09:00 UTC
      setInterval(async () => {
        const now = new Date();
        if (now.getUTCDay() === 1 && now.getUTCHours() === 9 && now.getUTCMinutes() < 60) {
          try {
            const { runWeeklyClientDigests } = await import("./services/client-digest");
            await runWeeklyClientDigests();
          } catch (err) {
            console.error("[Client Digest] Weekly run failed (non-fatal):", err);
          }
        }
      }, 60 * 60 * 1000);
    },
  );
})();
