// ── Router mount registration ──────────────────────────────────────────────
// This file exists solely to document and mount all sub-routers that are
// imported in routes.ts but must be wired up via app.use().
//
// Called once inside registerRoutes() — see routes.ts for the call site.
import type { Express } from "express";
import callTrackingRouter from "./routes/call-tracking";
import formTrackingRouter from "./routes/form-tracking";
import leadsRouter from "./routes/leads";
import dashboardAgencyRouter from "./routes/dashboard-agency";
import dashboardAdminRouter from "./routes/dashboard-admin";
import widgetRouter from "./routes/widget";

export function mountSubRouters(app: Express) {
  app.use("/api/call-tracking", callTrackingRouter);
  app.use("/api/form-tracking", formTrackingRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/dashboard/agency", dashboardAgencyRouter);
  app.use("/api/dashboard/admin", dashboardAdminRouter);
  app.use("/api/widget", widgetRouter);
}
