import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { mountSubRouters } from "./route-mounts";
import accountFeatureFallbacksRouter from "./routes/account-feature-fallbacks";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { sessionMiddleware } from "./auth";
// Session middleware is now mounted ONCE here — before mountSubRouters and
// registerRoutes — so req.session is always populated regardless of which
// sub-router or hostname middleware runs first.
// DO NOT add a second app.use(sessionMiddleware()) anywhere else.
// The conditional /api/-only wrapper that was in routes.ts has been removed.

const app = express();
const httpServer = createServer(app);

// Trust Railway's / Replit's reverse proxy so secure cookies and req.secure work correctly
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function publicHost(req: Request) {
  return String(req.headers["x-nexus-host"] || req.headers["x-forwarded-host"] || req.headers.host || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

function shouldRewriteToSitesRenderer(req: Request) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const host = publicHost(req);
  if (!/^(pages|page|seo|local)\./.test(host)) return false;
  // ✅ CHANGED: approved pages.* hosts have their own dedicated enhanced renderer.
  // Do not rewrite them to /sites/:domain/:slug before that router can run.
  return false;
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

// ── Session middleware — mount ONCE, globally, before all routers ─────────────
// Previously this was conditionally applied only to /api/ requests inside
// routes.ts, but mountSubRouters() (domain middleware) runs before that check
// so req.path was evaluated before session was attached on admin subdomains.
// saveUninitialized:false means no session row is created for public pages.
app.use(sessionMiddleware());

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
    const { pool: pgPool, db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const exec = (stmt: string) => pgPool.query(stmt).catch(() => {});
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
    console.log("[startup] Schema migrations: ALTER TABLE columns ensured.");
  } catch (err) {
    console.error("[startup] Job recovery failed (non-fatal):", err);
  }
}

(async () => {
  app.use("/", accountFeatureFallbacksRouter);

  app.use((req, _res, next) => {
    if (shouldRewriteToSitesRenderer(req)) {
      const host = publicHost(req);
      const originalUrl = req.originalUrl || req.url;
      const path = req.path.replace(/^\/+/, "");
      const query = originalUrl.includes("?") ? originalUrl.slice(originalUrl.indexOf("?")) : "";
      req.url = `/sites/${host}/${path}${query}`;
      console.log("[PUBLIC_TO_SITES_REWRITE]", { host, originalUrl, rewrittenUrl: req.url });
    }
    next();
  });

  mountSubRouters(app);

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    res.status(status).json({ message });
  });

  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });

  setImmediate(() => {
    runBackgroundStartup();
    seedDatabase().catch((err) => console.error("[startup] Seed failed:", err));
  });
})();
