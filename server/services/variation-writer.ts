import * as db from "../storage";
import { logApiUsage } from "./usage-logger";
import { callAI } from "./ai-provider";

const CORE_SECTIONS = ["intro", "how_it_works", "benefits", "faq", "cta"] as const;
const EXTENDED_SECTIONS = ["local_context", "use_case", "proof_trust", "pain_point", "local_stat"] as const;
const SEO_EXPANSION_SECTIONS = ["comparison", "pricing_factors", "best_fit", "software_integration"] as const;
const SECTIONS = [...CORE_SECTIONS, ...EXTENDED_SECTIONS, ...SEO_EXPANSION_SECTIONS] as const;
export const VARIATION_BANK_SECTION_COUNT = SECTIONS.length;
export const VARIATION_BANK_AI_CALLS_PER_SERVICE = 1;
type Section = typeof SECTIONS[number];

type BankPayload = Partial<Record<Section, string[]>>;

export interface BrandContext {
  brandName?: string;
  brandDescription?: string;
  voiceAndTone?: string;
  industryName?: string;
  industryDescription?: string;
}

const SECTION_INSTRUCTIONS: Record<Section, string> = {
  intro: "5 variations. Each variation: 2 short HTML paragraphs, 90-120 words total. Use {{service}} {{city}} {{state}} {{state_abbr}} {{landmark}} {{business_culture}}.",
  how_it_works: "5 variations. Each variation: 3 short HTML paragraphs, 120-160 words total. Use {{service}} {{city}} {{state}} {{brand}} {{business_count}}. Explain process from review to implementation.",
  benefits: "5 variations. Each variation: 4 short HTML paragraphs with bold lead sentences, 140-180 words total. Use {{service}} {{city}} {{state}} {{brand}} {{payment_regulations}}.",
  faq: "5 variations. Each variation: 5 concise Q&A pairs, 180-230 words total. Use {{service}} {{city}} {{state}} {{brand}} {{payment_regulations}}. Format each pair as <p><strong>Q: Question?</strong></p><p>Answer.</p>.",
  cta: "5 variations. Each variation: 1 HTML paragraph, 50-70 words. Use {{service}} {{city}} {{state}} {{brand}}. Vary urgency, trust, value, ease, and results.",
  local_context: "5 variations. Each variation: 1 HTML paragraph, 70-95 words. Use {{service}} {{city}} {{state}} {{state_abbr}} {{business_count}} {{business_culture}}.",
  use_case: "5 variations. Each variation: 2 short HTML paragraphs, 90-120 words total. Use {{service}} {{city}} {{state}} {{brand}} {{business_culture}}. Describe a realistic business scenario.",
  proof_trust: "5 variations. Each variation: 2 short HTML paragraphs, 80-110 words total. Use {{service}} {{city}} {{state}} {{brand}}. Establish credibility without inventing awards, guarantees, licenses, reviews, or certifications.",
  pain_point: "5 variations. Each variation: 2 short HTML paragraphs, 80-110 words total. Use {{service}} {{city}} {{state}} {{brand}} {{payment_regulations}}. Surface realistic friction or risk.",
  local_stat: "5 variations. Each variation: 1 HTML paragraph, 65-90 words. Use {{service}} {{city}} {{state}} {{state_abbr}} {{business_count}}. Discuss general market pressure or operational impact without fake studies.",
  comparison: "5 variations. Each variation: 2 short HTML paragraphs, 90-125 words total. Use {{service}} {{city}} {{state}} {{brand}}. Compare against common alternatives, DIY, outdated systems, or generic providers without naming competitors.",
  pricing_factors: "5 variations. Each variation: 2 short HTML paragraphs, 90-125 words total. Use {{service}} {{city}} {{state}} {{brand}}. Explain cost drivers and value factors. Do not provide fake prices or guaranteed savings.",
  best_fit: "5 variations. Each variation: 2 short HTML paragraphs, 80-110 words total. Use {{service}} {{city}} {{state}} {{brand}}. Explain who this is best for and who may not need it yet.",
  software_integration: "5 variations. Each variation: 2 short HTML paragraphs, 90-125 words total. Use {{service}} {{city}} {{state}} {{brand}}. Discuss software workflow, reporting, POS/CRM/accounting/ecommerce considerations without inventing exact integrations.",
};

function buildContextBlock(service: string, ctx?: BrandContext): string {
  const lines: string[] = ["BUSINESS CONTEXT:"];
  if (ctx?.brandName) lines.push(`- Brand: ${ctx.brandName}`);
  if (ctx?.brandDescription) lines.push(`- About: ${ctx.brandDescription}`);
  if (ctx?.voiceAndTone) lines.push(`- Voice & Tone: ${ctx.voiceAndTone}`);
  if (ctx?.industryName) lines.push(`- Industry: ${ctx.industryName}`);
  if (ctx?.industryDescription) lines.push(`- Industry Description: ${ctx.industryDescription}`);
  lines.push(`- Service being promoted: ${service}`);
  return lines.join("\n");
}

function buildBankPrompt(service: string, sections: readonly Section[], ctx?: BrandContext): string {
  const sectionList = sections.map((section, idx) => `${idx + 1}. ${section}: ${SECTION_INSTRUCTIONS[section]}`).join("\n");
  const outputShape = sections.map(section => `  "${section}": ["<p>...</p>", "...", "...", "...", "..."]`).join(",\n");

  return `${buildContextBlock(service, ctx)}

You are writing reusable SEO variation-bank content for a white-pages/local SEO publishing engine.

IMPORTANT CONTRACT:
- Generate ONLY these sections in this response: ${sections.join(", ")}.
- Each requested section must contain exactly 5 reusable variations.
- Content must be location-agnostic and use placeholders only.
- Never use literal city names, state names, regions, landmarks, or geographic references.
- Return valid JSON only. No markdown. No code fences.

ALLOWED PLACEHOLDERS:
{{service}} {{city}} {{state}} {{state_abbr}} {{landmark}} {{business_culture}} {{brand}} {{business_count}} {{payment_regulations}}

SECTION REQUIREMENTS:
${sectionList}

QUALITY RULES:
- No filler phrases like "In today's world", "top-notch", "look no further", "your trusted partner", or "comprehensive solutions".
- Do not invent awards, reviews, guarantees, certifications, licenses, integrations, exact prices, or statistics.
- Use direct, practical business-owner language.
- Keep HTML clean: only <p>, <strong>, and simple text inside each variation.
${ctx?.voiceAndTone ? `- Match this voice and tone: ${ctx.voiceAndTone}` : ""}
${ctx?.industryName ? `- Make the content accurate for the ${ctx.industryName} industry.` : ""}

OUTPUT JSON SHAPE:
{
${outputShape}
}`;
}

function extractBalancedJson(raw: string): string | null {
  const stripped = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const start = stripped.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return null;
}

function normalizeVariations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => String(v || "").trim()).filter(v => v.length > 0).slice(0, 5);
}

function validatePayload(parsed: any, sections: readonly Section[]): BankPayload {
  const payload: BankPayload = {};
  for (const section of sections) payload[section] = normalizeVariations(parsed?.[section]);
  return payload;
}

function maxTokensForSections(sectionCount: number): number {
  if (sectionCount <= 4) return 7000;
  if (sectionCount <= 8) return 8000;
  return 8000;
}

async function writeBankPayload(
  payload: BankPayload,
  sections: readonly Section[],
  serviceName: string,
  accountId: string,
  websiteId: string,
): Promise<{ written: string[]; errors: Record<string, string> }> {
  const written: string[] = [];
  const errors: Record<string, string> = {};
  for (const section of sections) {
    const variations = payload[section];
    if (!variations?.length) {
      errors[section] = `No variations returned for ${section}`;
      continue;
    }
    try {
      await db.createVariationBank({ accountId, websiteId, service: serviceName, sectionName: section, variations });
      written.push(section);
    } catch (err: any) {
      errors[section] = err?.message ?? String(err);
    }
  }
  return { written, errors };
}

async function generateBankPayload(
  serviceName: string,
  accountId: string,
  websiteId: string,
  sections: readonly Section[],
  ctx: BrandContext | undefined,
  generationType: string,
): Promise<BankPayload> {
  const prompt = buildBankPrompt(serviceName, sections, ctx);
  const { text: raw, provider, promptTokens, completionTokens } = await callAI({
    prompt,
    maxTokens: maxTokensForSections(sections.length),
    temperature: 0.7,
  });

  try {
    await logApiUsage({ accountId, websiteId, generationType, modelUsed: provider, inputTokens: promptTokens, outputTokens: completionTokens });
  } catch (logErr: any) {
    console.warn("[usage-logger] variation_writing log failed (non-fatal):", logErr?.message);
  }

  const json = extractBalancedJson(raw);
  if (!json) throw new Error(`Claude did not return valid JSON for ${generationType}. Response starts: ${raw.slice(0, 300)}`);

  let parsed: any;
  try { parsed = JSON.parse(json); }
  catch (err: any) { throw new Error(`Variation bank JSON parse failed for ${generationType}: ${err?.message ?? String(err)}`); }

  return validatePayload(parsed, sections);
}

export async function writeVariationsForService(
  serviceName: string,
  accountId: string,
  websiteId: string,
  ctx?: BrandContext,
): Promise<{ written: string[]; errors: Record<string, string> }> {
  const payload = await generateBankPayload(serviceName, accountId, websiteId, SECTIONS, ctx, "variation_writing:full_14_section_bank");
  const result = await writeBankPayload(payload, SECTIONS, serviceName, accountId, websiteId);
  if (result.written.length === 0) {
    const firstError = Object.values(result.errors)[0] ?? "No variation bank sections written";
    throw new Error(`Full bank write failed for "${serviceName}": ${firstError}`);
  }
  return result;
}

/**
 * Fill only missing bank sections. This keeps the upgrade path reliable:
 * older 10-section banks only request the 4 new SEO expansion sections.
 */
export async function fillMissingSectionsForService(
  serviceName: string,
  accountId: string,
  websiteId: string,
  ctx?: BrandContext,
): Promise<{ filled: string[]; skipped: string[]; errors: string[] }> {
  const existing = await db.getVariationBanks(websiteId, serviceName);
  const existingSet = new Set(existing.map((b: any) => b.sectionName));
  const skipped = SECTIONS.filter(s => existingSet.has(s));
  const missing = SECTIONS.filter(s => !existingSet.has(s));

  if (missing.length === 0) return { filled: [], skipped: skipped as string[], errors: [] };

  const payload = await generateBankPayload(
    serviceName,
    accountId,
    websiteId,
    missing,
    ctx,
    `variation_writing:fill_missing_${missing.length}_sections`,
  );

  const result = await writeBankPayload(payload, missing, serviceName, accountId, websiteId);
  return {
    filled: result.written,
    skipped: skipped as string[],
    errors: Object.entries(result.errors).map(([section, message]) => `${section}: ${message}`),
  };
}
