// ── Router mount registration ─────────────────────────────────────────────────────────────────────────────────
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
import variationBankWriterFixRouter from "./routes/variation-bank-writer-fix";
import variationBankQueueRouter from "./routes/variation-bank-queue";
import agencyRoiDashboardRouter from "./routes/agency-roi-dashboard";
import agencyDashboardRouter from "./routes/agency-dashboard";
import agencyMonthlyReportRouter from "./routes/agency-monthly-report";
import pageIntelligenceRouter from "./routes/page-intelligence";
import clientDomainsRouter from "./routes/client-domains";
import searchConsoleAdminRouter from "./routes/search-console-admin";
import intentActionsRouter from "./routes/intent-actions";
import actionReviewDecisionRouter from "./routes/action-review-decision";
import deploymentQaRouter from "./routes/deployment-qa";
import systemIntegrityRouter from "./routes/system-integrity";
import bulkGenerateJobFastRouter from "./routes/bulk-generate-job-fast";
import coreApiRouter from "./routes/core-api";
import publishedPagesSearchRouter from "./routes/published-pages-search";
import legacyPublicUrlRedirectRouter from "./routes/legacy-public-url-redirect";
import { registerDebugSectionsRoute } from "./routes/debug-sections";
import sitePreviewRouter from "./routes/site-preview";
import pagesSubdomainPublicRouter from "./routes/pages-subdomain-public";
import spotonPagesRouter from "./routes/spoton-pages";
import onboardingLiveRouter from "./routes/onboarding-live";
import nexusStripeRouter from "./routes/nexus-stripe";
import actionReviewActiveRouter from "./routes/action-review-active";
import autonomousControlPlaneRouter from "./routes/autonomous-control-plane";
import bankHealthRouter from "./routes/bank-health";
import clientDomainHomepageRouter from "./routes/client-domain-homepage";
import intentGovernanceRouter from "./routes/intent-governance";
import intentGovernanceRunRouter from "./routes/intent-governance-run";
import jobsRouter from "./routes/jobs";
import publicPagesEnhancedRouter from "./routes/public-pages-enhanced";
import publicWebsiteDomainsRouter from "./routes/public-website-domains";
import websiteDomainEditRouter from "./routes/website-domain-edit";
import brandR2RepairRouter from "./routes/brand-r2-repair";

export function mountSubRouters(app: Express) {
  app.use("/", authLiveRouter);
  app.use("/", variationBankWriterFixRouter);
  app.use("/", variationBankQueueRouter);
  app.use("/", coreApiRouter);
  app.use("/", brandR2RepairRouter);
  app.use("/", agencyRoiDashboardRouter);
  app.use("/", agencyDashboardRouter);
  app.use("/", agencyMonthlyReportRouter);
  app.use("/", pageIntelligenceRouter);
  app.use("/", clientDomainsRouter);
  app.use("/", searchConsoleAdminRouter);
  app.use("/", intentActionsRouter);
  app.use("/", actionReviewDecisionRouter);
  app.use("/", deploymentQaRouter);
  app.use("/", systemIntegrityRouter);
  app.use("/", bulkGenerateJobFastRouter);
  app.use("/", publishedPagesSearchRouter);
  app.use("/", legacyPublicUrlRedirectRouter);
  app.use("/", sitePreviewRouter);

  // Public pages.* host renderer. This must run before older public/static/R2
  // fallbacks so https://pages.clientdomain.com/{slug} uses the same enhanced
  // HTML shell that works in /sites/:domain/:slug admin preview.
  app.use("/", pagesSubdomainPublicRouter);

  app.use("/", spotonPagesRouter);
  app.use("/", onboardingLiveRouter);
  app.use("/", nexusStripeRouter);
  app.use("/", actionReviewActiveRouter);
  app.use("/", autonomousControlPlaneRouter);
  app.use("/", bankHealthRouter);
  app.use("/", clientDomainHomepageRouter);
  app.use("/", intentGovernanceRouter);
  app.use("/", intentGovernanceRunRouter);
  app.use("/", jobsRouter);
  app.use("/", publicPagesEnhancedRouter);
  app.use("/", publicWebsiteDomainsRouter);
  app.use("/", websiteDomainEditRouter);
  app.use("/api/call-tracking", callTrackingRouter);
  app.use("/api/form-tracking", formTrackingRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/dashboard/agency", dashboardAgencyRouter);
  app.use("/", dashboardAdminRouter);
  app.use("/api/widget", widgetRouter);
  registerDebugSectionsRoute(app);
}
