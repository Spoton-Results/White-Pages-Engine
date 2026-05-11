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
import agencyDashboardHotfixRouter from "./routes/agency-dashboard-hotfix";
import systemIntegrityRouter from "./routes/system-integrity";
import intentGovernanceRunHotfixRouter from "./routes/intent-governance-run-hotfix";
import actionReviewDecisionHotfixRouter from "./routes/action-review-decision-hotfix";
import actionReviewActiveRouter from "./routes/action-review-active";
import clientDomainsRouter from "./routes/client-domains";
import clientDomainHomepageRouter from "./routes/client-domain-homepage";
import publicWebsiteDomainsRouter from "./routes/public-website-domains";
import legacyPublicUrlRedirectRouter from "./routes/legacy-public-url-redirect";
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
  return res.status(503).json({ message: "Database is waking up or recovering. Please retry in a moment.", code: "DATABASE_RECOVERY", retryAfterSeconds: 10 });
}

app.use(express.json({ limit: "10mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware());

// IMPORTANT:
// Legacy admin preview URLs like:
//   /sites/domain.com/slug
// should NEVER behave like public SEO URLs.
// Force them to redirect to the clean public hostname architecture.
app.use(legacyPublicUrlRedirectRouter);

app.use(clientDomainsRouter);
app.use(publicWebsiteDomainsRouter);
app.use(clientDomainHomepageRouter);
app.use(agencyDashboardHotfixRouter);
app.use(actionReviewActiveRouter);
app.use(actionReviewDecisionHotfixRouter);
app.use(intentGovernanceRunHotfixRouter);
app.use(nexusStripeRouter);
app.use(bankHealthRouter);
app.use(searchConsoleAdminRouter);
app.use(agencyRoiDashboardRouter);
app.use(agencyMonthlyReportRouter);
app.use(systemIntegrityRouter);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;
  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) { capturedJsonResponse = bodyJson; return originalResJson.apply(res, [bodyJson, ...args]); };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) logLine += ` :: ${JSON.stringify(capturedJsonResponse).substring(0, 200)}`;
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
      console.error("[startup] Schema ensure failed:", err?.message || err);
    });
    await Promise.all([
      exec(`ALTER TABLE sitemaps ADD COLUMN IF NOT EXISTS xml_content TEXT`),
      exec(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS gsc_submitted_at TIMESTAMP, ADD COLUMN IF NOT EXISTS duplicate_flag BOOLEAN DEFAULT false, ADD COLUMN IF NOT EXISTS duplicate_of_slug VARCHAR(500), ADD COLUMN IF NOT EXISTS duplicate_similarity DECIMAL(5,4), ADD COLUMN IF NOT EXISTS trust_score INTEGER, ADD COLUMN IF NOT EXISTS evidence_score INTEGER, ADD COLUMN IF NOT EXISTS content_quality_score INTEGER`),
      exec(`ALTER TABLE websites ADD COLUMN IF NOT EXISTS protection_mode BOOLEAN DEFAULT false, ADD COLUMN IF NOT EXISTS protection_expires_at TIMESTAMP, ADD COLUMN IF NOT EXISTS warmup_day INTEGER DEFAULT 0, ADD COLUMN IF NOT EXISTS warmup_page_cap_override INTEGER`),
      exec(`ALTER TABLE onboarding_submissions ADD COLUMN IF NOT EXISTS governor_results JSONB, ADD COLUMN IF NOT EXISTS brand_input_score INTEGER, ADD COLUMN IF NOT EXISTS brand_input_result JSONB, ADD COLUMN IF NOT EXISTS gap_report JSONB`),
      exec(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS monthly_seo_spend NUMERIC(10,2) DEFAULT 0`),
      exec(`CREATE TABLE IF NOT EXISTS client_domains (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id TEXT NOT NULL,
        account_id TEXT,
        hostname TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending_dns',
        cloudflare_hostname_id TEXT,
        ownership_txt_name TEXT,
        ownership_txt_value TEXT,
        ssl_status TEXT,
        error TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        verified_at TIMESTAMP
      )`),
      exec(`CREATE INDEX IF NOT EXISTS idx_client_domains_website ON client_domains(website_id)`),
      exec(`CREATE INDEX IF NOT EXISTS idx_client_domains_hostname ON client_domains(hostname)`),
      exec(`CREATE TABLE IF NOT EXISTS fallback_hit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 1,
        first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
        promoted BOOLEAN NOT NULL DEFAULT false,
        promoted_at TIMESTAMP
      )`),
      exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_fallback_hit_logs_site_slug_unique ON fallback_hit_logs(website_id, slug)`),
      exec(`CREATE INDEX IF NOT EXISTS idx_fallback_hit_logs_site ON fallback_hit_logs(website_id)`),
      exec(`CREATE TABLE IF NOT EXISTS client_report_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        report_type TEXT NOT NULL DEFAULT 'monthly_visibility',
        expires_at TIMESTAMP,
        revoked_at TIMESTAMP,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_viewed_at TIMESTAMP,
        view_count INTEGER DEFAULT 0
      )`),
      exec(`CREATE INDEX IF NOT EXISTS idx_client_report_links_token ON client_report_links(token)`),
      exec(`CREATE INDEX IF NOT EXISTS idx_client_report_links_account ON client_report_links(account_id)`),
    ]);
    console.log("[startup] Schema migrations ensured.");
    await seedDatabase();
  } catch (err) {
    if (isDatabaseRecoveryError(err)) { console.warn("[startup] Database is recovering; startup tasks skipped and will be retried later."); return; }
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
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") serveStatic(app);
  else { const { setupVite } = await import("./vite"); await setupVite(httpServer, app); }

  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  const listenOptions = process.env.NODE_ENV === "production" ? { port, host, reusePort: true } : { port, host };

  httpServer.listen(listenOptions, () => {
    log(`serving on http://${host}:${port}`);
    setImmediate(() => { runBackgroundStartup().catch((err) => { if (isDatabaseRecoveryError(err)) { console.warn("[startup] Database recovery during background startup."); return; } console.error("[startup] Background startup crashed:", err); }); });
  });
})();
