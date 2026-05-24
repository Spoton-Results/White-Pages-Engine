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

// ✅ CORE API — was NEVER imported or mounted.
// core-api.ts handles ALL of these routes:
//   /api/accounts, /api/agencies, /api/websites, /api/locations,
//   /api/services, /api/brand-profiles, /api/industries, /api/blueprints,
//   /api/query-clusters, /api/pages, /api/generation-jobs, /api/variation-banks,
//   /api/sitemaps, /api/public/contact, /health, /_health
//
// Without this mount, every one of those routes fell through to the Vite
// SPA catch-all and returned <!DOCTYPE html> — causing every tab in the
// app to appear empty (frontend parsed HTML as empty JSON data).
import coreApiRouter from "./routes/core-api";

// ✅ FIXED: published-pages-search was NEVER imported or mounted.
// GET /api/websites/:websiteId/pages/search was falling through to the
// Vite SPA catch-all and returning <!DOCTYPE html> instead of JSON —
// causing the Published Pages tab to always show "No published pages yet."
import publishedPagesSearchRouter from "./routes/published-pages-search";

// ✅ CHANGED: legacy-public-url-redirect intercepts GET /sites/:domain/:slug
// on public (non-admin, non-localhost) hosts and 301-redirects to the
// canonical https://host/slug URL.  Admin and localhost requests fall through
// via next() so sitePreviewRouter below still handles admin previews.
// Must be mounted BEFORE sitePreviewRouter so the redirect fires first.
// ✅ CHANGED: debug-sections exports a named function, not a default router.
//   registerDebugSectionsRoute(app) is called directly inside mountSubRouters.
import legacyPublicUrlRedirectRouter from "./routes/legacy-public-url-redirect";
import { registerDebugSectionsRoute } from "./routes/debug-sections";

// ✅ FIXED: site-preview handles GET /sites/:domain/:slug for ALL client domains.
// Previously only pages.spotonresults.com was served by spoton-pages.ts.
// Any other domain (e.g. pages.elitepages.io) fell through to the Vite
// SPA catch-all, returning a blank page instead of the rendered page HTML.
import sitePreviewRouter from "./routes/site-preview";

// ── ✅ FIXED: Previously orphaned routers — never imported or mounted ────────
// Every router below existed in server/routes/ but had zero entry in this file.
// Every request to their routes fell through to the Vite SPA catch-all and
// returned <!DOCTYPE html> instead of JSON or HTML — making those features
// completely non-functional.

// spoton-pages.ts: Live production page serving for spotonresults.com /
// pages.spotonresults.com. Uses host-matching middleware (not path params),
// so it does NOT conflict with site-preview.ts (/sites/:domain/:slug).
// Also provides /api/spoton-pages-repair-copy and /api/spoton-pages-debug/:slug.
import spotonPagesRouter from "./routes/spoton-pages";

// onboarding-live.ts: Live onboarding flow for new accounts/agencies.
import onboardingLiveRouter from "./routes/onboarding-live";

// nexus-stripe.ts: Stripe billing — subscriptions, webhooks, payment routes.
import nexusStripeRouter from "./routes/nexus-stripe";

// action-review-active.ts: Active action review queue.
import actionReviewActiveRouter from "./routes/action-review-active";

// autonomous-control-plane.ts: Autonomous AI control panel routes.
import autonomousControlPlaneRouter from "./routes/autonomous-control-plane";

// bank-health.ts: Variation bank health check endpoints (23KB — full diagnostics).
import bankHealthRouter from "./routes/bank-health";

// client-domain-homepage.ts: Client domain homepage serving.
import clientDomainHomepageRouter from "./routes/client-domain-homepage";

// intent-governance.ts: Intent governance rule management.
import intentGovernanceRouter from "./routes/intent-governance";

// intent-governance-run.ts: Intent governance execution/run endpoints.
import intentGovernanceRunRouter from "./routes/intent-governance-run";

// jobs.ts: Generation jobs management (list, status, cancel).
import jobsRouter from "./routes/jobs";

// public-pages-enhanced.ts: Enhanced public page serving with extra metadata.
import publicPagesEnhancedRouter from "./routes/public-pages-enhanced";

// public-website-domains.ts: Public domain resolution for client sites.
import publicWebsiteDomainsRouter from "./routes/public-website-domains";

// website-domain-edit.ts: Website domain editing endpoints.
import websiteDomainEditRouter from "./routes/website-domain-edit";

export function mountSubRouters(app: Express) {
  // ── AUTH FIRST — must be mounted before any router that might intercept /api/auth/* ──
  // auth-live.ts was previously never imported or mounted anywhere.
  // All /api/auth/login, /api/auth/me, /api/auth/logout, /api/auth/debug
  // routes were falling through to other handlers, returning Unauthorized.
  app.use("/", authLiveRouter);

  // ✅ CHANGED: core-api mounted at root — defines full /api/* paths internally.
  // This fixes every tab in the app returning empty data.
  app.use("/", coreApiRouter);

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

  // ✅ CHANGED: Mount published-pages-search router.
  // GET /api/websites/:websiteId/pages/search was never mounted —
  // falling through to Vite catch-all, returning HTML instead of JSON.
  // This is the route the Published Pages tab calls for all page listing,
  // filtering, search, and facets.
  app.use("/", publishedPagesSearchRouter);

  // ✅ CHANGED: legacy-public-url-redirect mounted BEFORE sitePreviewRouter.
  // Public /sites/:domain/:slug requests get 301-redirected to canonical URL.
  // Admin/localhost requests fall through via next() to sitePreviewRouter.
  app.use("/", legacyPublicUrlRedirectRouter);

  // ✅ CHANGED: Mount site-preview router.
  // GET /sites/:domain/:slug now serves rendered page HTML for ALL client
  // domains — not just pages.spotonresults.com.
  app.use("/", sitePreviewRouter);

  // ── ✅ FIXED: Previously orphaned routers now mounted ──────────────
  // spoton-pages uses host-matching middleware — no conflict with site-preview.
  app.use("/", spotonPagesRouter);

  // Onboarding, billing, and feature routers.
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

  // ── Other unmounted routers ──────────────────────────────────────────
  app.use("/api/call-tracking", callTrackingRouter);
  app.use("/api/form-tracking", formTrackingRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/dashboard/agency", dashboardAgencyRouter);
  app.use("/api/dashboard/admin", dashboardAdminRouter);
  app.use("/api/widget", widgetRouter);

  // ✅ CHANGED: debug-sections exports a named function, not a default router.
  // registerDebugSectionsRoute(app) registers GET /api/debug/page-sections/:websiteId/:slug
  // directly on the Express app — mounting it via app.use() would crash.
  registerDebugSectionsRoute(app);
}
