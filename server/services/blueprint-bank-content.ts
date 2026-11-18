import { normalizeBulkText } from "../../shared/bulk-generation-plan";

type Bank = { sectionName: string; variations: unknown };
type LayoutSection = { name?: string; sectionKey?: string; key?: string; required?: boolean };
type SectionPlan = { requiredKeys: string[]; optionalKeys?: string[]; story?: boolean };
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
const storyKeys = new Set(["customer_success_stories", "success_stories", "case_study", "case_studies", "testimonial", "testimonials"]);
const allowedKeys = new Set([...Object.values(sectionAliases), ...storyKeys]);
const sectionToken = (value: string) => normalizeBulkText(value.replace(/\{[^}]*\}/g, "")).replace(/ /g, "");
const storyTokens = new Set([...storyKeys].map(sectionToken));
const templateLayouts: Record<string, SectionPlan> = {
  stateoverview: { requiredKeys: ["intro"], optionalKeys: ["local_stat"] },
  whymattersin: { requiredKeys: ["local_context"], optionalKeys: ["pain_point"] },
  brandoverview: { requiredKeys: ["proof_trust"], optionalKeys: ["best_fit"] },
  topfeaturesandbenefits: { requiredKeys: ["benefits"], optionalKeys: ["software_integration"] },
  industryspecificusecases: { requiredKeys: ["use_case"] },
  pricingandcomparison: { requiredKeys: ["pricing_factors", "comparison"] },
  gettingstartedin: { requiredKeys: ["how_it_works"] },
  gettingstarted: { requiredKeys: ["how_it_works"] },
};

function resolveSectionPlan(section: LayoutSection): SectionPlan | undefined {
  const explicit = section.sectionKey || section.key;
  const label = String(section.name || explicit || "");
  const token = sectionToken(label);
  if (explicit) {
    if (!allowedKeys.has(explicit) || (storyTokens.has(token) && !storyKeys.has(explicit))) return undefined;
    return { requiredKeys: [explicit], story: storyKeys.has(explicit) };
  }
  if (storyTokens.has(token)) return { requiredKeys: [], story: true };
  if (/^\s*\{\{?\s*brand\s*\}\}?\s+overview\s*$/i.test(label)) return templateLayouts.brandoverview;
  if (templateLayouts[token]) return templateLayouts[token];
  const key = sectionAliases[token];
  return key ? { requiredKeys: [key] } : undefined;
}
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
  const templateVars = Object.fromEntries(Object.entries(input.vars).map(([key, value]) => [key.toLowerCase(), value]));
  const replace = (text: string, html: boolean) => String(text || "").replace(/\{\{\s*([\w_]+)\s*\}\}|\{([\w_]+)\}/g, (_match, first, second) => {
    const key = String(first || second).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(templateVars, key)) throw new Error(`Unsupported template variable ${key}; publication blocked.`);
    return html ? escapeHtml(templateVars[key]) : templateVars[key];
  });
  const figures = input.baselineHtml.match(/<figure\b[\s\S]*?<\/figure>/gi) || [];
  const demo = divAt(input.baselineHtml, input.baselineHtml.indexOf('<div style="background:#1e40af;'));
  const cta = divAt(input.baselineHtml, input.baselineHtml.indexOf('<div style="background:#2563eb;color:#fff;border-radius:.75rem;padding:2rem;'));
  const output: string[] = [demo];
  let hasCta = false;
  let substantive = 0;
  const topic = normalizeBulkText(input.clusterKeyword || "");
  const filledVariations = (bank: Bank | undefined): string[] => Array.isArray(bank?.variations)
    ? bank.variations.filter((value): value is string => typeof value === "string" && words(value.replace(/&(?:nbsp|#160|#xa0);/gi, " ")) > 0)
    : [];
  const copyFor = (key: string): string | undefined => {
    let candidates = filledVariations(input.banks.find(bank => bank.sectionName === key));
    if (topic && key !== "cta" && key !== "proof_trust") {
      candidates = candidates.filter(value => normalizeBulkText(value.replace(/\{\{[^}]*\}\}/g, "").replace(/<[^>]*>/g, " ")).includes(topic) && words(value) >= 35);
    }
    return candidates[0];
  };
  const planned = sections.map(section => ({ section, label: String(section.name || section.sectionKey || section.key || ""), plan: resolveSectionPlan(section) }));
  const unmapped = planned.filter(item => !item.plan && item.section.required !== false);
  if (unmapped.length) throw new Error(`Blueprint sections need explicit supported bank sectionKey mappings: ${unmapped.map(item => JSON.stringify(item.label)).join(", ")}; publication blocked.`);
  const missing = planned.flatMap(item => item.plan && !item.plan.story && item.section.required !== false
    ? item.plan.requiredKeys.filter(key => !(key === "cta" && cta) && !copyFor(key)).map(key => `${item.label} (${key})`)
    : []);
  if (missing.length) throw new Error(`${topic ? "Cluster-specific" : "Required"} bank copy missing for: ${missing.join(", ")}. Generic service copy will not be relabeled as this topic.`);
  for (const item of planned) {
    const { section, label, plan } = item;
    if (!plan) continue;
    if (!plan.story && plan.requiredKeys.length === 1 && plan.requiredKeys[0] === "cta" && cta) {
      output.push(cta); hasCta = true; continue;
    }
    let parts: Array<{ key: string; copy: string }>;
    if (plan.story) {
      const banks = input.banks.filter(bank => storyTokens.has(sectionToken(bank.sectionName)) && (!plan.requiredKeys.length || plan.requiredKeys.some(key => sectionToken(key) === sectionToken(bank.sectionName))));
      parts = banks.flatMap(bank => {
        const copy = filledVariations(bank)[0];
        return copy ? [{ key: bank.sectionName, copy }] : [];
      });
      if (!parts.length) continue;
    } else {
      const required = plan.requiredKeys.map(key => ({ key, copy: copyFor(key) }));
      if (required.some(part => !part.copy)) continue;
      parts = [...required, ...(plan.optionalKeys || []).map(key => ({ key, copy: copyFor(key) }))]
        .filter((part): part is { key: string; copy: string } => typeof part.copy === "string");
    }
    const bodies = parts.map(part => {
      const body = replace(part.copy, true);
      if (/<\s*(script|iframe|object|embed|form)\b|\son[a-z]+\s*=|javascript\s*:/i.test(body)) throw new Error(`Unsafe markup in bank section "${label}"; publication blocked.`);
      return body;
    });
    const key = plan.story ? "customer_success_stories" : parts[0].key;
    output.push(`<section data-bank-section="${key}"><h2 style="font-size:1.35rem;font-weight:700;margin:2rem 0 .75rem">${escapeHtml(replace(label, false))}</h2>\n${bodies.join("\n")}</section>`);
    if (!plan.story && parts.some(part => part.key !== "cta" && part.key !== "proof_trust")) substantive++;
    if (parts.some(part => part.key === "cta")) hasCta = true;
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
