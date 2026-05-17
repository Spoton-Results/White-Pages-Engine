import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile } from "fs/promises";

const allowlist = ["@google/generative-ai","axios","connect-pg-simple","cors","date-fns","drizzle-orm","drizzle-zod","express","express-rate-limit","express-session","jsonwebtoken","memorystore","multer","nanoid","nodemailer","openai","passport","passport-local","pg","stripe","uuid","ws","xlsx","zod","zod-validation-error"];

async function patchBulkGeneratorForMaxPages() {
  const file = "server/services/bulk-background.ts";
  let source = await readFile(file, "utf-8");
  if (!source.includes("function forceTargetSlugDimensions")) {
    source = source.replace("function namespaceSlugWithBlueprint(slug: string, blueprint: any, settings: any): string {", `function forceTargetSlugDimensions(slug: string, target: { locationName: string; locationType: string; stateAbbr: string; stateName: string }): string {
  let next = slugifySegment(slug);
  const location = slugifySegment(target.locationName);
  const state = slugifySegment(target.stateName);
  const abbr = slugifySegment(target.stateAbbr);
  if (target.locationType === "city") {
    const cityState = slugifySegment(\`${"${target.locationName}-${target.stateAbbr}"}\`);
    if (location && !next.includes(location)) next = \`${"${next}--${cityState}"}\`;
    else if (abbr && !next.includes(\`-${"${abbr}"}\`) && !next.endsWith(abbr)) next = \`${"${next}--${abbr}"}\`;
  } else if (target.locationType === "state") {
    if (state && !next.includes(state) && abbr && !next.includes(abbr)) next = \`${"${next}--${state}"}\`;
  }
  return next.replace(/-{3,}/g, "--").replace(/^-|-$/g, "");
}

function namespaceSlugWithBlueprint(slug: string, blueprint: any, settings: any): string {`);
  }
  source = source.replace(/\n  if \(blueprintTemplate\) \{\n    const slugUsesLocation = \/\\\{location\|\\\{city\/i\.test\(blueprintTemplate\.slugTemplate\);\n    const slugUsesState = \/\\\{state\/i\.test\(blueprintTemplate\.slugTemplate\);\n    const hasCityTargets = targets\.some\(t => t\.locationType === "city"\);\n    if \(slugUsesState && !slugUsesLocation && hasCityTargets\) \{\n      const seenStates = new Set<string>\(\);\n      targets = targets\.filter\(t => \{\n        if \(seenStates\.has\(t\.stateAbbr\.toUpperCase\(\)\)\) return false;\n        seenStates\.add\(t\.stateAbbr\.toUpperCase\(\)\);\n        return true;\n      \}\);\n      totalPages = services\.length \* clusterCount \* targets\.length;\n      console\.log\(`\[bulk-background\] State-level blueprint detected — deduplicated to \$\{targets\.length\} unique state targets \(\$\{totalPages\} total pages\)`\);\n    \}\n  \}/, "\n  // Max-pages rule: never reduce selected city targets. Missing city/state slug dimensions are appended below.");
  if (!source.includes("forceTargetSlugDimensions(finalSlug, t)")) {
    source = source.replace("finalSlug = namespaceSlugWithBlueprint(finalSlug, blueprint, settings as any);", "finalSlug = namespaceSlugWithBlueprint(finalSlug, blueprint, settings as any);\n          finalSlug = forceTargetSlugDimensions(finalSlug, t);");
  }
  await writeFile(file, source);
}

async function patchBulkGeneratorUiToBackendCampaign() {
  const file = "client/src/pages/bulk-generator/index.tsx";
  let source = await readFile(file, "utf-8");
  if (source.includes("backendCampaignLocked: true")) return;
  const pattern = /\n    const queue: QueueItem\[\] = \[\];[\s\S]*?\n    await submitJobForBlueprint\(queue\[0\]\);/;
  const replacement = `
    const queryClusterIds = selectedQueryClusterIds();
    const locationPayload = runBothLocations ? buildExpandedCityPayload() : buildLocationPayload();
    const payload: Record<string, any> = {
      services: Array.from(selectedServices),
      ...locationPayload,
      overwrite,
      runAllBlueprints: cycleBlueprints && blueprints.length > 1,
      blueprintIds: cycleBlueprints && blueprints.length > 1 ? blueprints.map((bp: any) => bp.id) : bpIds,
      backendCampaignLocked: true,
    };
    if (queryClusterIds.length > 0) payload.queryClusterIds = queryClusterIds;

    accumulatedRef.current = { created: 0, skipped: 0, errors: 0 };
    handledTerminalJobRef.current = "";
    setBpQueueDisplay({ idx: 0, total: 1, label: payload.runAllBlueprints ? \`Backend campaign · \\${bpIds.length} blueprints\` : "Backend campaign" });
    setLastResult(null);
    setLastFailure("");
    setIsRunningAll(true);
    setServiceProgress(Array.from(selectedServices).map((service) => ({ service, status: "pending", created: 0, updated: 0, skipped: 0, errors: 0 })));
    try {
      const data = await apiFetch<{ jobId: string }>(\`/api/websites/\${websiteId}/bulk-campaign\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setActiveJobId(data.jobId);
      qc.invalidateQueries({ queryKey: ["/api/jobs"] });
    } catch (err: any) {
      setIsRunningAll(false);
      const message = err?.message || "Failed to start backend campaign";
      setLastFailure(message);
      toast({ title: "Failed to start backend campaign", description: message, variant: "destructive" });
    }`;
  source = source.replace(pattern, replacement);
  await writeFile(file, source);
}

async function buildAll() {
  await rm("dist", { recursive: true, force: true });
  await patchBulkGeneratorForMaxPages();
  await patchBulkGeneratorUiToBackendCampaign();
  console.log("building client...");
  await viteBuild();
  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));
  await esbuild({ entryPoints: ["server/index.ts"], platform: "node", bundle: true, format: "cjs", outfile: "dist/index.cjs", define: { "process.env.NODE_ENV": '"production"' }, minify: true, external: externals, logLevel: "info" });
}

buildAll().catch((err) => { console.error(err); process.exit(1); });
