import { readFileSync, writeFileSync } from "fs";

const file = "server/index.ts";
let source = readFileSync(file, "utf8");

source = source.replace(/\nfunction publicHost\(req: Request\) \{[\s\S]*?\n\}\n\nfunction shouldRewriteToSitesRenderer\(req: Request\) \{[\s\S]*?\n\}\n/, "\n");

source = source.replace(/\n\s*app\.use\(\(req, _res, next\) => \{\n\s*if \(shouldRewriteToSitesRenderer\(req\)\) \{[\s\S]*?\n\s*\}\n\s*next\(\);\n\s*\}\);\n/, "\n");

writeFileSync(file, source);
console.log("[build-patch] Removed public-to-sites rewrite workaround from server/index.ts");
