import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const failures: string[] = [];

function file(path: string) {
  const fullPath = resolve(root, path);
  if (!existsSync(fullPath)) {
    failures.push(`Missing file: ${path}`);
    return "";
  }
  return readFileSync(fullPath, "utf8");
}

function expectContains(label: string, content: string, needle: string) {
  if (!content.includes(needle)) failures.push(`${label} missing: ${needle}`);
}

function expectAny(label: string, content: string, needles: string[]) {
  if (!needles.some((needle) => content.includes(needle))) {
    failures.push(`${label} missing one of: ${needles.join(" | ")}`);
  }
}

const app = file("client/src/App.tsx");
const layout = file("client/src/components/layout/DashboardLayout.tsx");
const agencyDashboard = file("client/src/pages/agency-dashboard-mvp.tsx");
const reportCenter = file("client/src/pages/report-links-mvp.tsx");
const roiRoutes = file("server/routes/agency-roi-dashboard.ts");
const monthlyRoutes = file("server/routes/agency-monthly-report.ts");

expectContains("App route", app, "@/pages/agency-dashboard-mvp");
expectContains("App route", app, "@/pages/report-links-mvp");
expectContains("App route", app, "path=\"/agency-dashboard\"");
expectContains("App route", app, "path=\"/report-links\"");

expectContains("Sidebar navigation", layout, "Agency Dashboard");
expectContains("Sidebar navigation", layout, "Report Center");
expectContains("Sidebar navigation", layout, "href: \"/agency-dashboard\"");
expectContains("Sidebar navigation", layout, "href: \"/report-links\"");

expectContains("Agency Dashboard MVP", agencyDashboard, "Here’s what we built for your clients this month.");
expectContains("Agency Dashboard MVP", agencyDashboard, "ROI Score");
expectContains("Agency Dashboard MVP", agencyDashboard, "churnRiskFlags");
expectContains("Agency Dashboard MVP", agencyDashboard, "recommendedNextAction");
expectContains("Agency Dashboard MVP", agencyDashboard, "/api/agency-dashboard/summary");
expectContains("Agency Dashboard MVP", agencyDashboard, "/api/agency-dashboard/clients");
expectContains("Agency Dashboard MVP", agencyDashboard, "Copy Share Link");
expectContains("Agency Dashboard MVP", agencyDashboard, "Report Links");
expectContains("Agency Dashboard MVP", agencyDashboard, "md:hidden");
expectContains("Agency Dashboard MVP", agencyDashboard, "md:block");

expectContains("Report Center MVP", reportCenter, "Report Center");
expectContains("Report Center MVP", reportCenter, "/api/agency-dashboard/report-links");
expectContains("Report Center MVP", reportCenter, "Copy Share Link");
expectContains("Report Center MVP", reportCenter, "Regenerate Link");
expectContains("Report Center MVP", reportCenter, "Revoke Link");
expectContains("Report Center MVP", reportCenter, "md:hidden");
expectContains("Report Center MVP", reportCenter, "md:block");

expectContains("ROI backend", roiRoutes, "calculateRoiScore");
expectContains("ROI backend", roiRoutes, "getChurnRiskFlags");
expectContains("ROI backend", roiRoutes, "getRecommendedNextAction");
expectContains("ROI backend", roiRoutes, "/api/agency-dashboard/summary");
expectContains("ROI backend", roiRoutes, "/api/agency-dashboard/clients");
expectContains("ROI backend", roiRoutes, "pagesBuiltThisMonth");
expectContains("ROI backend", roiRoutes, "clientsWithNewWork");
expectContains("ROI backend", roiRoutes, "reportsReady");
expectContains("ROI backend", roiRoutes, "COUNT(vbc.website_id)");

expectContains("Monthly report backend", monthlyRoutes, "/api/agency-dashboard/clients/:accountId/monthly-report");
expectContains("Monthly report backend", monthlyRoutes, "/api/agency-dashboard/clients/:accountId/monthly-report/share");
expectContains("Monthly report backend", monthlyRoutes, "/api/agency-dashboard/report-links");
expectContains("Monthly report backend", monthlyRoutes, "/api/agency-dashboard/report-links/:linkId/revoke");
expectContains("Monthly report backend", monthlyRoutes, "/api/agency-dashboard/report-links/:linkId/regenerate");
expectContains("Monthly report backend", monthlyRoutes, "/r/:token");
expectContains("Monthly report backend", monthlyRoutes, "ROI Score");
expectContains("Monthly report backend", monthlyRoutes, "Recommended Next Action");
expectContains("Monthly report backend", monthlyRoutes, "What We Built This Month");
expectAny("Monthly report backend", monthlyRoutes, ["Print / Save PDF", "Print"]);

if (failures.length) {
  console.error("\nAgency retention smoke test failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Agency retention smoke test passed.");
console.log("Checked: sidebar nav, /agency-dashboard, /report-links, monthly report, share links, public /r/:token, ROI fields, mobile layout markers.");
