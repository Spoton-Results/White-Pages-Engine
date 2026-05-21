// ── Router mount registration ────────────────────────────────────────────────
// All sub-routers that exist in server/routes/ but are NOT wired up
// inside routes.ts must be mounted here.
// Called once inside index.ts via mountSubRouters(app) BEFORE registerRoutes().
import type { Express } from "express";
import authLiveRouter from "./routes/auth-live";
import callTrackingRouter from "./routes/call-tracking";
import formTrackingRouter from "./routes/form-tracking";
import leadsRouter from "./routes/leads";
import dashboardAgencyRouter from "./routes/dashboard-agency";
import dashboardAdminRouter from "./routes/dashboard-admin";
import widgetRouter from "./routes/widget";

// ── THE REAL FIX ─────────────────────────────────────────────────────
// agency-roi-dashboard.ts registers routes with FULL paths already inside the
// router itself (e.g. router.get("/api/agency-dashboard/summary", ...)).
// That means it must be mounted at "/" (root), NOT at a sub-prefix like
// "/api/agency-dashboard" — otherwise Express would double the prefix.
//
// It was NEVER imported or mounted anywhere, causing Express to fall through
// to the Vite SPA catch-all and return <!DOCTYPE html> instead of JSON,
// producing the "Unexpected token '<'" error in the Executive ROI Dashboard.
import agencyRoiDashboardRouter from "./routes/agency-roi-dashboard";
import agencyDashboardRouter from "./routes/agency-dashboard";
import agencyMonthlyReportRouter from "./routes/agency-monthly-report";

// ── Restored post-rollback routers ──────────────────────────────────
// These routers all define their own full /api/* paths internally,
// so they must be mounted at root "/" to avoid double-prefixing.
import pageIntelligenceRouter from "./routes/page-intelligence";
import clientDomainsRouter from "./routes/client-domains";
import searchConsoleAdminRouter from "./routes/search-console-admin";
import intentActionsRouter from "./routes/intent-actions";
import actionReviewDecisionRouter from "./routes/action-review-decision";
import deploymentQaRouter from "./routes/deployment-qa";
import systemIntegrityRouter from "./routes/system-integrity";

// ── Bulk generation + campaign router ───────────────────────────────
// bulk-generate-job-fast.ts defines FULL /api/* paths internally:
//   POST /api/websites/:websiteId/bulk-generate-job
//   POST /api/websites/:websiteId/bulk-campaign
// It was NEVER mounted, so every Generate click fell through to the
// Vite SPA catch-all and returned <!DOCTYPE html> instead of JSON —
// causing the "Unexpected token '<', \"<!DOCTYPE\"... is not valid JSON" error.
import bulkGenerateJobFastRouter from "./routes/bulk-generate-job-fast";

export function mountSubRouters(app: Express) {
  // ── AUTH FIRST — must be mounted before any router that might intercept /api/auth/* ──
  // auth-live.ts was previously never imported or mounted anywhere.
  // All /api/auth/login, /api/auth/me, /api/auth/logout, /api/auth/debug
  // routes were falling through to other handlers, returning Unauthorized.
  app.use("/", authLiveRouter);

  // Agency ROI Dashboard routes include the full /api/agency-dashboard/* prefix
  // internally, so mount at root to avoid double-prefixing.
  app.use("/", agencyRoiDashboardRouter);
  app.use("/", agencyDashboardRouter);
  app.use("/", agencyMonthlyReportRouter);

  // ── Restored post-rollback routers ────────────────────────────────
  app.use("/", pageIntelligenceRouter);
  app.use("/", clientDomainsRouter);
  app.use("/", searchConsoleAdminRouter);
  app.use("/", intentActionsRouter);
  app.use("/", actionReviewDecisionRouter);
  app.use("/", deploymentQaRouter);
  app.use("/", systemIntegrityRouter);

  // ── Bulk generation + campaign ─────────────────────────────────────
  app.use("/", bulkGenerateJobFastRouter);

  // ── Other unmounted routers ──────────────────────────────────────────
  app.use("/api/call-tracking", callTrackingRouter);
  app.use("/api/form-tracking", formTrackingRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/dashboard/agency", dashboardAgencyRouter);
  app.use("/api/dashboard/admin", dashboardAdminRouter);
  app.use("/api/widget", widgetRouter);
}
