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
  if (!needles.some((needle) => content.includes(needle))) failures.push(`${label} missing one of: ${needles.join(" | ")}`);
}

const app = file("client/src/App.tsx");
const layout = file("client/src/components/layout/DashboardLayout.tsx");
const page = file("client/src/pages/client-domains.tsx");
const route = file("server/routes/client-domains.ts");
const server = file("server/index.ts");
const pkg = file("package.json");

expectContains("App route", app, "@/pages/client-domains");
expectContains("App route", app, "path=\"/client-domains\"");

expectContains("Sidebar navigation", layout, "Client Domains");
expectContains("Sidebar navigation", layout, "href: \"/client-domains\"");

expectContains("Client Domains UI", page, "Client Domains");
expectContains("Client Domains UI", page, "website selector");
expectAny("Client Domains UI", page, ["Choose a website", "Select Nexus Website"]);
expectContains("Client Domains UI", page, "pages.clientdomain.com");
expectContains("Client Domains UI", page, "CNAME");
expectContains("Client Domains UI", page, "dnsTarget");
expectContains("Client Domains UI", page, "Check Status");
expectContains("Client Domains UI", page, "Health Test");
expectContains("Client Domains UI", page, "Open Site");
expectContains("Client Domains UI", page, "Copy DNS Instructions");
expectContains("Client Domains UI", page, "/api/websites/${websiteId}/client-domains");
expectContains("Client Domains UI", page, "/api/client-domains/${id}/check");

expectContains("Client domain route", route, "resolveClientDomain");
expectContains("Client domain route", route, "getRequestHostname");
expectContains("Client domain route", route, "x-nexus-host");
expectContains("Client domain route", route, "cf-custom-hostname");
expectContains("Client domain route", route, "x-forwarded-host");
expectContains("Client domain route", route, "CREATE TABLE IF NOT EXISTS client_domains");
expectContains("Client domain route", route, "CREATE TABLE IF NOT EXISTS fallback_hit_logs");
expectContains("Client domain route", route, "logCustomDomainFallbackHit");
expectContains("Client domain route", route, ".well-known/nexus-domain-health");
expectContains("Client domain route", route, "serveSitemap");
expectContains("Client domain route", route, "serveRobots");
expectContains("Client domain route", route, "resolveHomepageSlug");
expectContains("Client domain route", route, "CLIENT_DOMAIN_CNAME_TARGET");
expectContains("Client domain route", route, "CLOUDFLARE_ZONE_ID");
expectContains("Client domain route", route, "CLOUDFLARE_API_TOKEN");

expectContains("Server startup", server, "app.use(clientDomainsRouter)");
expectContains("Server startup", server, "CREATE TABLE IF NOT EXISTS client_domains");
expectContains("Server startup", server, "CREATE TABLE IF NOT EXISTS fallback_hit_logs");
expectContains("Server startup", server, "idx_client_domains_hostname");
expectContains("Server startup", server, "idx_fallback_hit_logs_site_slug_unique");

expectContains("Package scripts", pkg, "smoke:client-domains");
expectContains("Package scripts", pkg, "qa:client-domains");

if (failures.length) {
  console.error("\nClient domains smoke test failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Client domains smoke test passed.");
console.log("Checked: route registration, sidebar link, admin UI, Cloudflare vars, hostname resolver, homepage resolver, sitemap/robots, health endpoint, fallback-hit logging, and startup migrations.");
