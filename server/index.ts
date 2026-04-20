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
  // Run safe schema migrations (idempotent ADD COLUMN IF NOT EXISTS)
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`ALTER TABLE sitemaps ADD COLUMN IF NOT EXISTS xml_content TEXT`);
    console.log("[startup] Schema migration: sitemaps.xml_content ensured.");
    // Phase 7 — Launch Governors columns
    await db.execute(sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS gsc_submitted_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS governor_results JSONB`);
    console.log("[startup] Schema migration: Phase 7 governor columns ensured.");
    // Phase 8 — Safety Rails columns
    await db.execute(sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS duplicate_flag BOOLEAN DEFAULT false`);
    await db.execute(sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS duplicate_of_slug VARCHAR(500)`);
    await db.execute(sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS duplicate_similarity DECIMAL(5,4)`);
    await db.execute(sql`ALTER TABLE websites ADD COLUMN IF NOT EXISTS protection_mode BOOLEAN DEFAULT false`);
    await db.execute(sql`ALTER TABLE websites ADD COLUMN IF NOT EXISTS protection_expires_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE websites ADD COLUMN IF NOT EXISTS warmup_day INTEGER DEFAULT 0`);
    await db.execute(sql`ALTER TABLE websites ADD COLUMN IF NOT EXISTS warmup_page_cap_override INTEGER`);
    await db.execute(sql`ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS brand_input_score INTEGER`);
    await db.execute(sql`ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS brand_input_result JSONB`);
    await db.execute(sql`ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS gap_report JSONB`);
    console.log("[startup] Schema migration: Phase 8 safety-rails columns ensured.");
    // Phase 9 — Health Score + Client Digest tables
    await db.execute(sql`CREATE TABLE IF NOT EXISTS launch_health_scores (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      website_id varchar NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      score integer DEFAULT 0,
      max_score integer DEFAULT 100,
      breakdown jsonb,
      calculated_at timestamp DEFAULT NOW()
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS client_weekly_digests (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      website_id varchar NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      account_id varchar NOT NULL,
      recipient_email varchar(255) NOT NULL,
      subject varchar(500),
      body_html text,
      body_text text,
      sent_at timestamp,
      created_at timestamp DEFAULT NOW(),
      status varchar(20) DEFAULT 'pending'
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pages_duplicate_flag ON pages(website_id, duplicate_flag)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_websites_protection_mode ON websites(protection_mode)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_launch_health_website ON launch_health_scores(website_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_launch_health_date ON launch_health_scores(calculated_at)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_client_digest_website ON client_weekly_digests(website_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_client_digest_status ON client_weekly_digests(status)`);
    console.log("[startup] Schema migration: Phase 9 health/digest tables ensured.");
    // Core page indexes + FK indexes — each wrapped independently so one failure can't skip the rest
    const idxStatements = [
      `CREATE INDEX IF NOT EXISTS idx_pages_website_slug ON pages(website_id, slug)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_website_status ON pages(website_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_updated_at ON pages(updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_pages_website_id ON pages(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_page_versions_page_id ON page_versions(page_id)`,
      `CREATE INDEX IF NOT EXISTS idx_page_versions_active ON page_versions(page_id, is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_websites_account_id ON websites(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_locations_account_id ON locations(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_services_account_id ON services(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_blueprints_account_id ON blueprints(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_blueprints_website_id ON blueprints(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_pages_account_id ON hub_pages(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_pages_website_id ON hub_pages(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_generation_jobs_account_id ON generation_jobs(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_generation_jobs_website_id ON generation_jobs(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sitemaps_website_id ON sitemaps(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_query_clusters_account_id ON query_clusters(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_internal_links_website_id ON internal_links(website_id)`,
      `CREATE INDEX IF NOT EXISTS idx_accounts_agency_id ON accounts(agency_id)`,
    ];
    for (const stmt of idxStatements) {
      try { await db.execute(sql.raw(stmt)); } catch (_) { /* already exists or column absent — skip */ }
    }
    console.log("[startup] Database indexes ensured.");

    // Automation tables (added in automation phase)
    await db.execute(sql`CREATE TABLE IF NOT EXISTS admin_notifications (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      website_id varchar NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      type text NOT NULL, title text NOT NULL, message text NOT NULL,
      metadata jsonb, read_at timestamp, created_at timestamp NOT NULL DEFAULT NOW()
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS demotion_logs (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      website_id varchar NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      page_id varchar NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      from_tier integer NOT NULL, to_tier integer NOT NULL,
      reason text NOT NULL, created_at timestamp NOT NULL DEFAULT NOW()
    )`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_admin_notif_website ON admin_notifications(website_id, created_at DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_demotion_logs_website ON demotion_logs(website_id, created_at DESC)`);
    console.log("[startup] Automation tables ensured.");

    // Domain migration: update old subdomain-based domains to root domain + /pages proxyPath
    await db.execute(sql`
      UPDATE websites
      SET domain = 'spotonresults.com',
          name   = CASE WHEN name = 'SpotOn Results Main' THEN 'SpotOn Results' ELSE name END,
          settings = settings || '{"proxyPath":"/pages","parentDomain":"spotonresults.com"}'::jsonb
      WHERE domain = 'pages.spotonresults.com'
    `);
    await db.execute(sql`
      UPDATE websites
      SET domain = 'pagessubtrackers.spotonresults.com',
          name   = CASE WHEN name = 'Subtracker pages' OR name = 'SubTrackers' THEN 'SubTrackers' ELSE name END,
          settings = settings
            - 'proxyPath'
            - 'parentDomain'
            || '{"proxyPath":"","parentDomain":"pagessubtrackers.spotonresults.com"}'::jsonb
      WHERE domain IN ('subtrackers.spotonresults.com', 'pagessubtrackers.spotonresults.com')
        AND id = (SELECT id FROM websites WHERE name = 'SubTrackers' OR name = 'Subtracker pages' LIMIT 1)
    `);
    console.log("[startup] Domain migration: old subdomain URLs updated to root domain + /pages (idempotent).");
  } catch (err) {
    console.error("[startup] Schema migration failed (non-fatal):", err);
  }

  // Seed database
  try {
    await seedDatabase();
  } catch (err) {
    console.error("Seeding failed (non-fatal):", err);
  }

  // Sync ALL website published-page counters
  try {
    const { getWebsites, syncWebsitePublishedCount } = await import("./storage");
    const allWebsites = await getWebsites();
    if (allWebsites.length > 0) {
      console.log(`[startup] Syncing published-page counts for ${allWebsites.length} website(s)...`);
      await Promise.all(allWebsites.map(w => syncWebsitePublishedCount(w.id).catch(() => {})));
      console.log("[startup] Page count sync complete.");
    }
  } catch (err) {
    console.error("[startup] Page count sync failed (non-fatal):", err);
  }

  // Re-tier all scored pages with current Tier 1 threshold
  try {
    const { getWebsites, bulkUpdatePageTiers } = await import("./storage");
    const allWebsites = await getWebsites();
    if (allWebsites.length > 0) {
      console.log(`[startup] Applying Tier 1 threshold (80) to all scored pages...`);
      let totalPromoted = 0;
      await Promise.all(allWebsites.map(async w => {
        try {
          const { promoted } = await bulkUpdatePageTiers(w.id, 80);
          totalPromoted += promoted;
        } catch { /* non-fatal */ }
      }));
      if (totalPromoted > 0) console.log(`[startup] Promoted ${totalPromoted} pages to Tier 1.`);
      console.log("[startup] Tier assignment complete.");
    }
  } catch (err) {
    console.error("[startup] Tier assignment failed (non-fatal):", err);
  }

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
        await updateGenerationJob(j.id, { status: "pending", startedAt: null });
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
