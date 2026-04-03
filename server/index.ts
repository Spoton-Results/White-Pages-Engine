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
    },
  );
})();
