import express, { type Request, Response, NextFunction } from "express";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { ensureBulkTransactionSafety, repairPagesMissingActiveVersions } from "./services/bulk-transaction-safety";

// ── Auth ────────────────────────────────────────────────────────────────────
import authLiveRouter from "./routes/auth-live";
import { sessionMiddleware } from "./auth";

// ── Core platform routers ────────────────────────────────────────────────────
import jobsRouter from "./routes/jobs";
import bulkGenerateJobFastRouter from "./routes/bulk-generate-job-fast";
import websiteDomainEditRouter from "./routes/website-domain-edit";
import publishedPagesSearchRouter from "./routes/published-pages-search";
import publicPagesEnhancedRouter from "./routes/public-pages-enhanced";
import pageIntelligenceRouter from "./routes/page-intelligence";
import legacyPublicUrlRedirectRouter from "./routes/legacy-public-url-redirect";
import clientDomainsRouter from "./routes/client-domains";
import publicWebsiteDomainsRouter from "./routes/public-website-domains";
import clientDomainHomepageRouter from "./routes/client-domain-homepage";
import spotonPagesRouter from "./routes/spoton-pages-hotfix";

// ── Action review & intent governance ───────────────────────────────────────
import actionReviewActiveRouter from "./routes/action-review-active";
import actionReviewDecisionRouter from "./routes/action-review-decision-hotfix";
import intentGovernanceRouter from "./routes/intent-governance-run-hotfix";
import intentActionsRouter from "./routes/intent-actions";
import intentBuildRouter from "./routes/intent-build";

// ── Billing & search infrastructure ─────────────────────────────────────────
import nexusStripeRouter from "./routes/nexus-stripe";
import bankHealthRouter from "./routes/bank-health";
import searchConsoleAdminRouter from "./routes/search-console-admin";

// ── Agency dashboards & reporting ───────────────────────────────────────────
import agencyRoiDashboardRouter from "./routes/agency-roi-dashboard";
import agencyMonthlyReportRouter from "./routes/agency-monthly-report";
import agencyDashboardRouter from "./routes/agency-dashboard-hotfix";
import dashboardAdminRouter from "./routes/dashboard-admin";
import dashboardAgencyRouter from "./routes/dashboard-agency";

// ── Lead tracking & conversion ───────────────────────────────────────────────
import callTrackingRouter from "./routes/call-tracking";
import formTrackingRouter from "./routes/form-tracking";
import leadsRouter from "./routes/leads";

// ── Onboarding & widget ──────────────────────────────────────────────────────
import onboardingRouter from "./routes/onboarding-live";
import widgetRouter from "./routes/widget";

// ── System health & control plane ───────────────────────────────────────────
import systemIntegrityRouter from "./routes/system-integrity";
import autonomousControlPlaneRouter from "./routes/autonomous-control-plane";
import deploymentQaRouter from "./routes/deployment-qa";

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
  return (
    err?.code === "57P03" ||
    message.includes("database system is in recovery mode") ||
    message.includes("the database system is starting up")
  );
}

function sendDatabaseRecoveryResponse(_req: Request, res: Response) {
  res.setHeader("Retry-After", "10");
  return res.status(503).json({
    message: "Database is waking up or recovering. Please retry in a moment.",
    code: "DATABASE_RECOVERY",
    retryAfterSeconds: 10,
  });
}

function normalizeHost(value: unknown) {
  return String(value || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

function isAdminHost(host: string) {
  const landingDomain = normalizeHost(process.env.LANDING_DOMAIN || "spotonnexus.com");
  const appBaseHost = normalizeHost(process.env.APP_BASE_URL || "");
  const configuredAdminHost = normalizeHost(process.env.ADMIN_HOST || "admin.spotonnexus.com");
  const adminHosts = new Set(
    [configuredAdminHost, `admin.${landingDomain}`, appBaseHost].filter(Boolean),
  );
  return (
    adminHosts.has(host) ||
    host.endsWith(".up.railway.app") ||
    host.endsWith(".railway.app")
  );
}

function normalizeAdminHostHeaders(req: Request, _res: Response, next: NextFunction) {
  const host = normalizeHost(
    req.headers["x-nexus-host"] ||
    req.headers["cf-custom-hostname"] ||
    req.headers["x-forwarded-host"] ||
    req.headers.host,
  );

  if (isAdminHost(host)) {
    const landingDomain = normalizeHost(process.env.LANDING_DOMAIN || "spotonnexus.com");
    req.headers["x-nexus-host"] = landingDomain;
    req.headers["x-forwarded-host"] = landingDomain;
    delete req.headers["cf-custom-hostname"];
  }

  next();
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware());
app.use(normalizeAdminHostHeaders);

// ── Auth (must be before any protected /api routes) ──────────────────────────
app.use(authLiveRouter);

// ── Jobs (canonical job ownership — all /api/jobs/* must come from here) ─────
app.use(jobsRouter);

// ── Core page & site management ───────────────────────────────────────────────
app.use(bulkGenerateJobFastRouter);
app.use(websiteDomainEditRouter);
app.use(publishedPagesSearchRouter);
app.use(spotonPagesRouter);
app.use(publicPagesEnhancedRouter);
app.use(pageIntelligenceRouter);
app.use(legacyPublicUrlRedirectRouter);
app.use(clientDomainsRouter);
app.use(publicWebsiteDomainsRouter);
app.use(clientDomainHomepageRouter);

// ── Intent & action review ────────────────────────────────────────────────────
app.use(actionReviewActiveRouter);
app.use(actionReviewDecisionRouter);
app.use(intentGovernanceRouter);
app.use("/api/intent-actions", intentActionsRouter);
app.use("/api/intent-build", intentBuildRouter);

// ── Billing & search infrastructure ──────────────────────────────────────────
app.use(nexusStripeRouter);
app.use(bankHealthRouter);
app.use(searchConsoleAdminRouter);

// ── Agency dashboards & reporting ─────────────────────────────────────────────
app.use(agencyRoiDashboardRouter);
app.use(agencyMonthlyReportRouter);
app.use(agencyDashboardRouter);
app.use("/api/admin", dashboardAdminRouter);
app.use("/api/dashboard", dashboardAgencyRouter);

// ── Lead tracking & conversion ────────────────────────────────────────────────
app.use("/api/call-tracking", callTrackingRouter);
app.use("/api/form-tracking", formTrackingRouter);
app.use("/api/leads", leadsRouter);

// ── Onboarding & widget ───────────────────────────────────────────────────────
app.use("/api/onboarding", onboardingRouter);
app.use("/widget", widgetRouter);

// ── System health & control plane ─────────────────────────────────────────────
app.use(systemIntegrityRouter);
app.use(autonomousControlPlaneRouter);
app.use(deploymentQaRouter);

// ── Request logger ────────────────────────────────────────────────────────────
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
      if (capturedJsonResponse)
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).substring(0, 200)}`;
      log(logLine);
    }
  });
  next();
});

// ── Background startup (schema safety only — DDL migrations run via Drizzle) ──
async function runBackgroundStartup() {
  try {
    await ensureBulkTransactionSafety();
    const repaired = await repairPagesMissingActiveVersions();
    console.log(`[startup] Bulk transaction safety enabled. Repaired ${repaired} orphaned page(s).`);
    console.log("[startup] Schema safety checks complete.");
    await seedDatabase();
  } catch (err) {
    if (isDatabaseRecoveryError(err)) {
      console.warn("[startup] Database is recovering; startup tasks skipped and will be retried later.");
      return;
    }
    console.error("[startup] Background startup failed (non-fatal):", err);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (isDatabaseRecoveryError(err)) {
      console.warn("[db] Database recovery guard handled 57P03 for", req.method, req.originalUrl || req.url);
      return sendDatabaseRecoveryResponse(req, res);
    }
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  });

  serveStatic(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, async () => {
    log(`serving on port ${port}`);
    runBackgroundStartup();
  });
})();
