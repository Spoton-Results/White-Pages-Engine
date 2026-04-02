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

  // Resume any bulk background jobs that were interrupted by a server restart
  try {
    const { getStaleRunningJobs, updateGenerationJob } = await import("./storage");
    const { runBulkBackgroundJob } = await import("./services/bulk-background");
    const stale = await getStaleRunningJobs();
    const bulkJobs = stale.filter(j => Array.isArray((j.settings as any)?.services));
    if (bulkJobs.length > 0) {
      console.log(`[startup] Resuming ${bulkJobs.length} interrupted bulk job(s)...`);
      for (const j of bulkJobs) {
        await updateGenerationJob(j.id, { status: "pending", startedAt: null });
        setImmediate(() => {
          runBulkBackgroundJob(j.id).catch(err => {
            console.error("[startup] Failed to resume job", j.id, err);
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
    },
  );
})();
