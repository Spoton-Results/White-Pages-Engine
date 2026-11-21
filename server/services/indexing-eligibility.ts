type Node = Record<string, unknown>;
export interface IndexingEligibilityResult {
  eligible: boolean;
  schemaType: "JobPosting" | "VideoObject" | null;
  reasons: string[];
}
const object = (v: unknown): v is Node => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [v];
const typed = (v: Node, type: string) => list(v["@type"]).some(t => t === type || t === `https://schema.org/${type}` || t === `http://schema.org/${type}`);
const date = (v: unknown) => text(v) && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) && Number.isFinite(Date.parse(v));
const url = (v: unknown) => {
  if (!text(v)) return false;
  try { return ["https:", "http:"].includes(new URL(v).protocol); } catch { return false; }
};
const schemaContext = (v: unknown): boolean => list(v).every(c => typeof c === "string" && /^https?:\/\/schema\.org\/?$/.test(c));
function validJob(n: Node): boolean {
  const org = n.hiringOrganization;
  const local = list(n.jobLocation).some(l => object(l) && typed(l, "Place") && object(l.address) && typed(l.address, "PostalAddress") && text(l.address.addressCountry));
  const remote = n.jobLocationType === "TELECOMMUTE" && list(n.applicantLocationRequirements).some(l => object(l) && typed(l, "Country") && text(l.name));
  return text(n.title) && text(n.description) && date(n.datePosted) && object(org) && typed(org, "Organization") && text(org.name) && (local || remote);
}
function validVideo(n: Node): boolean {
  return text(n.name) && text(n.description) && date(n.uploadDate) && list(n.thumbnailUrl).some(url) && list(n.publication).some(e => object(e) && typed(e, "BroadcastEvent") && e.isLiveBroadcast === true && date(e.startDate) && date(e.endDate) && Date.parse(String(e.endDate)) > Date.parse(String(e.startDate)));
}

// Local structural evidence only; callers must verify publication, ownership and real content.
export function validateIndexingEligibility(html: string): IndexingEligibilityResult {
  const fail = (...reasons: string[]): IndexingEligibilityResult => ({ eligible: false, schemaType: null, reasons });
  if (typeof html !== "string" || html.length > 2000000) return fail("invalid_or_oversized_html");
  const source = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(template|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const scripts = /<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi;
  const candidates: Array<"JobPosting" | "VideoObject"> = [];
  const errors: string[] = [];
  let blocks = 0, nodes = 0;
  function visit(value: unknown, inherited: boolean, depth: number): void {
    if (++nodes > 10000 || depth > 64) throw new Error("jsonld_structure_limit");
    if (Array.isArray(value)) { value.forEach(v => visit(v, inherited, depth + 1)); return; }
    if (!object(value)) return;
    const context = value["@context"] === undefined ? inherited : schemaContext(value["@context"]);
    if (context && typed(value, "JobPosting") && validJob(value)) candidates.push("JobPosting");
    if (context && typed(value, "VideoObject") && validVideo(value)) candidates.push("VideoObject");
    if (value["@graph"] !== undefined) visit(value["@graph"], context, depth + 1);
  }
  for (const match of source.matchAll(scripts)) {
    const attrs = [...match[1].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)];
    const types = attrs.filter(a => a[1].toLowerCase() === "type");
    if (!types.some(a => (a[2] ?? a[3] ?? a[4] ?? "").trim().toLowerCase() === "application/ld+json")) continue;
    blocks++;
    if (types.length !== 1) { errors.push("ambiguous_script_type"); continue; }
    if (blocks > 100) return fail("jsonld_block_limit");
    try { visit(JSON.parse(match[2]), false, 0); } catch { errors.push("malformed_or_excessive_jsonld"); }
  }
  if (errors.length) return fail(...new Set(errors));
  if (!blocks) return fail("missing_jsonld");
  if (!candidates.length) return fail("no_supported_schema_with_required_evidence");
  return { eligible: true, schemaType: candidates[0], reasons: [] };
}
