import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const TARGET_DIRS = [
  path.join(ROOT, "server"),
  path.join(ROOT, "scripts"),
];

const SQL_PATTERNS = [
  /JOIN\s+[\w\.\"]+\s+\w+\s+ON\s+[^\n;]+=[^\n;]+/gi,
  /WHERE\s+[^\n;]+=[^\n;]+/gi,
];

const BAD_PATTERNS = [
  /\.id\s*=\s*\w+\.(account_id|website_id|service_id)/i,
  /(account_id|website_id|service_id)\s*=\s*\w+\.id/i,
  /WHERE\s+\w+\.id\s*=\s*\$\d+/i,
  /WHERE\s+(account_id|website_id|service_id)\s*=\s*\$\d+/i,
];

function walk(dir: string, files: string[] = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) files.push(full);
  }
  return files;
}

const findings: Array<{ file: string; line: number; text: string }> = [];

for (const dir of TARGET_DIRS) {
  if (!fs.existsSync(dir)) continue;

  for (const file of walk(dir)) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const looksSql = SQL_PATTERNS.some((pattern) => pattern.test(line));
      const bad = BAD_PATTERNS.some((pattern) => pattern.test(line));

      if (looksSql && bad && !line.includes("::text")) {
        findings.push({
          file: path.relative(ROOT, file),
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }
}

console.log("\n=== Canonical ID Safety Audit ===\n");

if (!findings.length) {
  console.log("PASS: No unsafe UUID/TEXT comparisons found.\n");
  process.exit(0);
}

console.log(`Found ${findings.length} potentially unsafe SQL comparisons:\n`);

for (const finding of findings) {
  console.log(`${finding.file}:${finding.line}`);
  console.log(`  ${finding.text}`);
  console.log();
}

console.log("Recommendation:");
console.log("Use canonical ID helpers or explicit ::text casts for all joins and WHERE comparisons.\n");

process.exit(1);
