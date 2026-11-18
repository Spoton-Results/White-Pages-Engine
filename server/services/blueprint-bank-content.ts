import { normalizeBulkText } from "../../shared/bulk-generation-plan";

type Bank = { sectionName: string; variations: unknown };
type LayoutSection = { name?: string; sectionKey?: string; key?: string; required?: boolean };
const sectionAliases: Record<string, string> = {
  intro: "intro", introduction: "intro", overview: "intro", stateoverview: "intro",
  localcontext: "local_context", localmarketcontext: "local_context", localservicearea: "local_context",
  painpoint: "pain_point", painpoints: "pain_point", problem: "pain_point", problemoverview: "pain_point", problemdescription: "pain_point", commonproblems: "pain_point", challenges: "pain_point",
  howitworks: "how_it_works", solution: "how_it_works", proposedsolution: "how_it_works", process: "how_it_works", implementation: "how_it_works",
  benefits: "benefits", whychooseus: "benefits",
  usecase: "use_case", usecases: "use_case", examples: "use_case",
  prooftrust: "proof_trust", trustsignals: "proof_trust", proof: "proof_trust", trustandcredibility: "proof_trust",
  localstat: "local_stat", localstatistics: "local_stat", marketdata: "local_stat",
  comparison: "comparison", sidebysideoverview: "comparison",
  pricingfactors: "pricing_factors", pricing: "pricing_factors", pricingconsiderations: "pricing_factors", costfactors: "pricing_factors",
  bestfit: "best_fit", whoisthisfor: "best_fit",
  softwareintegration: "software_integration", integrations: "software_integration",
  faq: "faq", faqs: "faq", frequentlyaskedquestions: "faq",
  cta: "cta", calltoaction: "cta", nextsteps: "cta", getstarted: "cta",
};
const allowedKeys = new Set(Object.values(sectionAliases));
const escapeHtml = (text: string) => String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const words = (html: string) => html.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;

function divAt(html: string, start: number): string {
  if (start < 0) return "";
  const tokens = /<\/?div\b[^>]*>/gi;
  tokens.lastIndex = start;
  let depth = 0;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(html))) {
    depth += /^<\//.test(token[0]) ? -1 : 1;
    if (depth === 0) return html.slice(start, tokens.lastIndex);
  }
  throw new Error("Existing page decoration contains an unclosed div; publication blocked.");
}

export function assembleBlueprintBankContent(input: {
  sections: unknown; banks: Bank[]; vars: Record<string, string>; baselineHtml: string;
  clusterKeyword?: string; requiredWordCount: number;
}): { contentHtml: string; wordCount: number } {
  if (!Array.isArray(input.sections) || !input.sections.length) throw new Error("Blueprint has no section plan; publication blocked.");
  const sections = input.sections as LayoutSection[];
  if (sections.length > 60) throw new Error("Blueprint has too many sections.");
  const replace = (text: string, html: boolean) => String(text || "").replace(/\{\{\s*([\w_]+)\s*\}\}|\{([\w_]+)\}/g, (_match, first, second) => {
    const key = first || second;
    if (!(key in input.vars)) throw new Error(`Unsupported template variable ${key}; publication blocked.`);
    return html ? escapeHtml(input.vars[key]) : input.vars[key];
  });
  const figures = input.baselineHtml.match(/<figure\b[\s\S]*?<\/figure>/gi) || [];
  const demo = divAt(input.baselineHtml, input.baselineHtml.indexOf('<div style="background:#1e40af;'));
  const cta = divAt(input.baselineHtml, input.baselineHtml.indexOf('<div style="background:#2563eb;color:#fff;border-radius:.75rem;padding:2rem;'));
  const output: string[] = [demo];
  let hasCta = false;
  let substantive = 0;
  const topic = normalizeBulkText(input.clusterKeyword || "");
  for (const section of sections) {
    const explicit = section.sectionKey || section.key;
    const label = String(section.name || explicit || "");
    const key = explicit ? (allowedKeys.has(explicit) ? explicit : undefined) : sectionAliases[normalizeBulkText(label.replace(/\{[^}]*\}/g, "")).replace(/ /g, "")];
    if (!key) {
      if (section.required === false) continue;
      throw new Error(`Blueprint section "${label}" needs an explicit supported bank sectionKey; publication blocked.`);
    }
    if (key === "cta" && cta) { output.push(cta); hasCta = true; continue; }
    const bank = input.banks.find(row => row.sectionName === key);
    let candidates = Array.isArray(bank?.variations) ? bank.variations.filter((value): value is string => typeof value === "string" && words(value) > 0) : [];
    if (topic && key !== "cta" && key !== "proof_trust") {
      candidates = candidates.filter(value => normalizeBulkText(value.replace(/\{\{[^}]*\}\}/g, "").replace(/<[^>]*>/g, " ")).includes(topic) && words(value) >= 35);
    }
    if (!candidates.length) {
      if (section.required === false) continue;
      throw new Error(`${topic ? "Cluster-specific" : "Required"} bank copy missing for "${label}". Generic service copy will not be relabeled as this topic.`);
    }
    const body = replace(candidates[0], true);
    if (/<\s*(script|iframe|object|embed|form)\b|\son[a-z]+\s*=|javascript\s*:/i.test(body)) throw new Error(`Unsafe markup in bank section "${label}"; publication blocked.`);
    output.push(`<section data-bank-section="${key}"><h2 style="font-size:1.35rem;font-weight:700;margin:2rem 0 .75rem">${escapeHtml(replace(label, false))}</h2>\n${body}</section>`);
    if (key !== "cta" && key !== "proof_trust") substantive++;
    if (key === "cta") hasCta = true;
    if (figures.length && key !== "cta") output.push(figures.shift()!);
  }
  if (!substantive) throw new Error("Blueprint contains no substantive supported content; publication blocked.");
  output.push(...figures);
  if (!hasCta) output.push(cta);
  const navigation = input.baselineHtml.match(/<h2\b[^>]*>(?:Cities We Serve in|Related Services in)[\s\S]*?<\/h2>\s*<ul\b[\s\S]*?<\/ul>/gi) || [];
  output.push(...navigation);
  const schemas = input.baselineHtml.match(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/gi) || [];
  output.push(...schemas.filter(value => !value.includes('"FAQPage"')));
  const contentHtml = output.filter(Boolean).join("\n");
  const wordCount = words(contentHtml.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
  if (wordCount < input.requiredWordCount) throw new Error(`Supported blueprint copy has ${wordCount} words; ${input.requiredWordCount} required. Publication blocked.`);
  return { contentHtml, wordCount };
}
