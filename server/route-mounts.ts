// ── Router mount registration ──────────────────────────────────────────────
// All sub-routers that exist in server/routes/ but are NOT wired up
// inside routes.ts must be mounted here.
// Called once inside index.ts via mountSubRouters(app) BEFORE registerRoutes().
import type { Express } from "express";
import callTrackingRouter from "./routes/call-tracking";
import formTrackingRouter from "./routes/form-tracking";
import leadsRouter from "./routes/leads";
import dashboardAgencyRouter from "./routes/dashboard-agency";
import dashboardAdminRouter from "./routes/dashboard-admin";
import widgetRouter from "./routes/widget";

// ── THE REAL FIX ───────────────────────────────────────────────────
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

export function mountSubRouters(app: Express) {
  // Agency ROI Dashboard routes include the full /api/agency-dashboard/* prefix
  // internally, so mount at root to avoid double-prefixing.
  app.use("/", agencyRoiDashboardRouter);
  app.use("/", agencyDashboardRouter);
  app.use("/", agencyMonthlyReportRouter);

  // ── Other unmounted routers ────────────────────────────────────────
  app.use("/api/call-tracking", callTrackingRouter);
  app.use("/api/form-tracking", formTrackingRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/dashboard/agency", dashboardAgencyRouter);
  app.use("/api/dashboard/admin", dashboardAdminRouter);
  app.use("/api/widget", widgetRouter);
}
