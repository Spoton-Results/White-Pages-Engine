import fs from "fs";
import path from "path";
import {
  getWebsiteByDomain,
  ingestExternalSearchMetrics,
  normalizeSearchConsoleExport,
} from "../server/services/external-search-intelligence";

async function main() {
  const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
  const domainArg = process.argv.find((arg) => arg.startsWith("--domain="));

  if (!fileArg || !domainArg) {
    throw new Error("Usage: tsx scripts/import-search-console-export.ts --file=export.json --domain=example.com");
  }

  const filePath = fileArg.split("=")[1];
  const domain = domainArg.split("=")[1];

  const resolvedPath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const website = await getWebsiteByDomain(domain);

  if (!website?.id) {
    throw new Error(`Website not found for domain: ${domain}`);
  }

  const raw = fs.readFileSync(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);

  const rows = Array.isArray(parsed) ? parsed : parsed.rows ?? [];

  const normalized = normalizeSearchConsoleExport({
    websiteId: website.id,
    rows,
  });

  const result = await ingestExternalSearchMetrics(normalized);

  console.log("\n=== SEARCH CONSOLE IMPORT ===\n");
  console.log(result);
  console.log("\n=== COMPLETE ===\n");
}

main().catch((err) => {
  console.error("[import-search-console-export] Fatal:", err);
  process.exitCode = 1;
});
