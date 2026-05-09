import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import bankHealthRouter from "./routes/bank-health";
import nexusStripeRouter from "./routes/nexus-stripe";
import searchConsoleAdminRouter from "./routes/search-console-admin";
import agencyRoiDashboardRouter from "./routes/agency-roi-dashboard";
import agencyMonthlyReportRouter from "./routes/agency-monthly-report";
import systemIntegrityRouter from "./routes/system-integrity";
import { sessionMiddleware } from "./auth";

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function isDatabaseRecoveryError(err: any) {
  const message = String(err?.message || "").toLowerCase();
  return err?.code === "57P03" || message.includes("database system is in recovery mode") || message.includes("the database system is starting up");
}

function sendDatabaseRecoveryResponse(_req: Request, res: Response) {
  res.setHeader("Retry-After", "10");
  return res.status(503).json({
    message: "Database is waking up or recovering. Please retry in a moment.",
    code: "DATABASE_RECOVERY",
    retryAfterSeconds: 10,
  });
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
app.use(sessionMiddleware());
app.use(nexusStripeRouter);
app.use(bankHealthRouter);
app.use(searchConsoleAdminRouter);
app.use(agencyRoiDashboardRouter);
app.use(agencyMonthlyReportRouter);
app.use(systemIntegrityRouter);

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
  try {
    const { pool: pgPool } = await import("./db");
    const exec = (stmt: string) => pgPool.query(stmt).catch((err) => {
      if (isDatabaseRecoveryError(err)) {
        console.warn("[startup] Database recovering during schema ensure; will retry on next request/run.");
        return;
      }
    });

    await Promise.all([
      exec(`ALTER TABLE sitemaps ADD COLUMN IF NOT EXISTS xml_content TEXT`),
      exec(`ALTER TABLE pages
              ADD COLUMN IF NOT EXISTS gsc_submitted_at TIMESTAMP,
              ADD COLUMN IF NOT EXISTS duplicate_flag BOOLEAN DEFAULT false,
              ADD COLUMN IF NOT EXISTS duplicate_of_slug VARCHAR(500),
              ADD COLUMN IF NOT EXISTS duplicate_similarity DECIMAL(5,4),
              ADD COLUMN IF NOT EXISTS trust_score INTEGER,
              ADD COLUMN IF NOT EXISTS evidence_score INTEGER,
              ADD COLUMN IF NOT EXISTS content_quality_score INTEGER`),
      exec(`ALTER TABLE websites
              ADD COLUMN IF NOT EXISTS protection_mode BOOLEAN DEFAULT false,
              ADD COLUMN IF NOT EXISTS protection_expires_at TIMESTAMP,
              ADD COLUMN IF NOT EXISTS warmup_day INTEGER DEFAULT 0,
              ADD COLUMN IF NOT EXISTS warmup_page_cap_override INTEGER`),
      exec(`ALTER TABLE onboarding_submissions
              ADD COLUMN IF NOT EXISTS governor_results JSONB,
              ADD COLUMN IF NOT EXISTS brand_input_score INTEGER,
              ADD COLUMN IF NOT EXISTS brand_input_result JSONB,
              ADD COLUMN IF NOT EXISTS gap_report JSONB`),
      exec(`ALTER TABLE accounts
              ADD COLUMN IF NOT EXISTS monthly_seo_spend NUMERIC(10,2) DEFAULT 0`),
    ]);

    console.log("[startup] Schema migrations ensured.");

    await seedDatabase();
  } catch (err) {
    if (isDatabaseRecoveryError(err)) {
      console.warn("[startup] Database is recovering; startup tasks skipped and will be retried later.");
      return;
    }
    console.error("[startup] Background startup failed (non-fatal):", err);
  }
}

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (isDatabaseRecoveryError(err)) {
      console.warn("[db] Database recovery guard handled 57P03 for", req.method, req.originalUrl || req.url);
      if (res.headersSent) return next(err);
      return sendDatabaseRecoveryResponse(req, res);
    }

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
  const host =
    process.env.HOST ||
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

  const listenOptions =
    process.env.NODE_ENV === "production"
      ? { port, host, reusePort: true }
      : { port, host };

  httpServer.listen(listenOptions, () => {
    log(`serving on http://${host}:${port}`);

    setImmediate(() => {
      runBackgroundStartup().catch((err) => {
        if (isDatabaseRecoveryError(err)) {
          console.warn("[startup] Database recovery during background startup.");
          return;
        }
        console.error("[startup] Background startup crashed:", err);
      });
    });

    setImmediate(async () => {
      try {
        const { scheduleDailyBackup } = await import("./backup");
        scheduleDailyBackup(3);
      } catch (err) {
        console.error("[backup] Failed to schedule daily backup (non-fatal):", err);
      }
    });

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

    setInterval(async () => {
      const now = new Date();
      if (now.getUTCDay() === 1 && now.getUTCHours() === 8) {
        try {
          const { sendWeeklySummaryEmails } = await import("./services/automation");
          await sendWeeklySummaryEmails();
        } catch (err) {
          console.error("[auto8] Weekly email failed (non-fatal):", err);
        }
      }
    }, 60 * 60 * 1000);

    setInterval(async () => {
      const now = new Date();
      if (now.getUTCDay() === 1 && now.getUTCHours() === 6) {
        try {
          const { runWeeklyLaunchHealth } = await import("./services/launch-health");
          await runWeeklyLaunchHealth();
        } catch (err) {
          console.error("[Launch Health] Weekly run failed (non-fatal):", err);
        }
      }
    }, 60 * 60 * 1000);

    setInterval(async () => {
      const now = new Date();
      if (now.getUTCDay() === 1 && now.getUTCHours() === 9) {
        try {
          const { runWeeklyClientDigests } = await import("./services/client-digest");
          await runWeeklyClientDigests();
        } catch (err) {
          console.error("[Client Digest] Weekly run failed (non-fatal):", err);
        }
      }
    }, 60 * 60 * 1000);
  });
})();