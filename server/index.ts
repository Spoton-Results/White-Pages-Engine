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

(async () => {
  // Run safe schema migrations (idempotent ADD COLUMN IF NOT EXISTS)
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`ALTER TABLE sitemaps ADD COLUMN IF NOT EXISTS xml_content TEXT`);
    console.log("[startup] Schema migration: sitemaps.xml_content ensured.");
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
    // Idempotent — only fires when the old domain is still present
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

  // Seed database on startup
  try {
    await seedDatabase();
  } catch (err) {
    console.error("Seeding failed (non-fatal):", err);
  }

  // Sync ALL website published-page counters on every startup.
  // Background jobs may have inserted pages without updating the counter
  // (e.g. cancelled mid-run, killed by a redeploy). This one-time pass
  // ensures the UI always shows the real count after any restart.
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

  // Resume any background jobs that were interrupted by a server restart
  try {
    const { getStaleRunningJobs, updateGenerationJob } = await import("./storage");
    const { runBulkBackgroundJob } = await import("./services/bulk-background");
    const { runBankWriteJob } = await import("./services/bank-write-background");
    const stale = await getStaleRunningJobs();

    // Bulk page-generation jobs
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

    // Bank-write jobs — reset any "running" services back to "pending" so they re-run
    const bankJobs = stale.filter(j => (j.settings as any)?.type === "bank_write");
    if (bankJobs.length > 0) {
      console.log(`[startup] Resuming ${bankJobs.length} interrupted bank-write job(s)...`);
      for (const j of bankJobs) {
        const settings = j.settings as any;
        // Reset any "running" service back to "pending" so it gets re-processed
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

      // Sitemap startup task — two-phase, runs in background after server is ready.
      //
      // Phase 1 (fast): warm the in-memory cache from any already-stored xml_content
      //   rows (single DB row per chunk — ~10ms each). Sites that have been regenerated
      //   at least once are fully covered here.
      //
      // Phase 2 (one-time migration): for any website whose sitemaps still have
      //   null xml_content (i.e. generated before the xml_content fix), run a full
      //   sitemap regeneration which stores the XML to the DB permanently. After this
      //   runs once, Phase 1 handles everything on every future restart.
      //
      // Both websites run in parallel so total time = max(site_a, site_b) not sum.
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
              // Phase 1: warm from stored xml_content (fast, ms per chunk)
              await warmSitemapCache(w.id);

              // Phase 2: if any chunk still has null xml_content, do a full regen
              // to store it permanently. This path runs at most once per website.
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
      // Uses runWeeklyAutoDemoteWithJobs so each run creates a visible Jobs dashboard entry
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
        }, 7 * 24 * 60 * 60 * 1000); // every 7 days
      }, 5 * 60 * 1000); // 5 minutes after startup

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
      }, 60 * 60 * 1000); // check every hour
    },
  );
})();
