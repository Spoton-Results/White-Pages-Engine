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
// agency-roi-dashboard.ts handles /api/agency-dashboard/* endpoints
// (summary, activity, coverage, clients) which the Executive ROI Dashboard
// page fetches. It was NEVER imported or mounted anywhere, causing Express to
// fall through to the Vite SPA catch-all and return HTML instead of JSON.
import agencyRoiDashboardRouter from "./routes/agency-roi-dashboard";
import agencyDashboardRouter from "./routes/agency-dashboard";
import agencyMonthlyReportRouter from "./routes/agency-monthly-report";

export function mountSubRouters(app: Express) {
  // ── Agency ROI Dashboard (Executive ROI Dashboard page) ──────────────────
  // Must come before the generic agencyDashboardRouter so the more specific
  // /api/agency-dashboard/summary|activity|coverage|clients routes match first.
  app.use("/api/agency-dashboard", agencyRoiDashboardRouter);
  app.use("/api/agency-dashboard", agencyDashboardRouter);
  app.use("/api/agency-dashboard", agencyMonthlyReportRouter);

  // ── Other unmounted routers ────────────────────────────────────────
  app.use("/api/call-tracking", callTrackingRouter);
  app.use("/api/form-tracking", formTrackingRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/dashboard/agency", dashboardAgencyRouter);
  app.use("/api/dashboard/admin", dashboardAdminRouter);
  app.use("/api/widget", widgetRouter);
}
