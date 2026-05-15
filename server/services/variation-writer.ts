import * as db from "../storage";
import { logApiUsage } from "./usage-logger";
import { callAI } from "./ai-provider";

const CORE_SECTIONS = ["intro", "how_it_works", "benefits", "faq", "cta"] as const;
export const VARIATION_BANK_SECTION_COUNT = CORE_SECTIONS.length;
export const VARIATION_BANK_AI_CALLS_PER_SERVICE = 1;
const SECTIONS = CORE_SECTIONS;
type Section = typeof SECTIONS[number];

type BankPayload = Record<Section, string[]>;

export interface BrandContext {
  brandName?: string;
  brandDescription?: string;
  voiceAndTone?: string;
  industryName?: string;
  industryDescription?: string;
}

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

function buildBankPrompt(service: string, ctx?: BrandContext): string {
  return `${buildContextBlock(service, ctx)}

You are writing reusable SEO variation-bank content for a white-pages/local SEO publishing engine.

IMPORTANT CONTRACT:
- This is ONE paid Claude call for the service.
- Generate ALL 5 core variation-bank sections in this single response.
- Each section must contain exactly 5 reusable variations.
- Content must be location-agnostic and use placeholders only.
- Never use literal city names, state names, regions, landmarks, or geographic references.
- Do not return markdown or code fences.
- Return valid JSON only.

ALLOWED PLACEHOLDERS:
{{service}} {{city}} {{state}} {{state_abbr}} {{landmark}} {{business_culture}} {{brand}} {{business_count}} {{payment_regulations}}

SECTION REQUIREMENTS:
1. intro
   - 5 variations
   - each variation: 2 HTML paragraphs, about 120-150 words total
   - use: {{service}} {{city}} {{state}} {{state_abbr}} {{landmark}} {{business_culture}}
   - each variation must open with a different hook and angle

2. how_it_works
   - 5 variations
   - each variation: 3 HTML paragraphs, about 180-220 words total
   - use: {{service}} {{city}} {{state}} {{brand}} {{business_count}}
   - describe the process from first contact to implementation

3. benefits
   - 5 variations
   - each variation: 4 HTML paragraphs with bold lead sentences, about 200-240 words total
   - use: {{service}} {{city}} {{state}} {{brand}} {{payment_regulations}}
   - each paragraph should highlight a different benefit

4. faq
   - 5 variations
   - each variation: 5 Q&A pairs, about 240-280 words total
   - use: {{service}} {{city}} {{state}} {{brand}} {{payment_regulations}}
   - format each pair as <p><strong>Q: Question?</strong></p><p>Answer.</p>

5. cta
   - 5 variations
   - each variation: 1 HTML paragraph, about 60-80 words
   - use: {{service}} {{city}} {{state}} {{brand}}
   - vary the angle: urgency, trust, value, ease, results

QUALITY RULES:
- No filler phrases like "In today's world", "top-notch", "look no further", "your trusted partner", or "comprehensive solutions".
- Do not invent specific awards, reviews, guarantees, certifications, licenses, or statistics.
- Use direct, practical, business-owner language.
- Keep HTML clean: only <p>, <strong>, and simple text inside each variation.
${ctx?.voiceAndTone ? `- Match this voice and tone: ${ctx.voiceAndTone}` : ""}
${ctx?.industryName ? `- Make the content accurate for the ${ctx.industryName} industry.` : ""}

OUTPUT JSON SHAPE:
{
  "intro": ["<p>...</p><p>...</p>", "...", "...", "...", "..."],
  "how_it_works": ["<p>...</p><p>...</p><p>...</p>", "...", "...", "...", "..."],
  "benefits": ["<p><strong>...</strong> ...</p><p><strong>...</strong> ...</p><p><strong>...</strong> ...</p><p><strong>...</strong> ...</p>", "...", "...", "...", "..."],
  "faq": ["<p><strong>Q: ...?</strong></p><p>...</p>...", "...", "...", "...", "..."],
  "cta": ["<p>...</p>", "...", "...", "...", "..."]
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
  return value
    .map(v => String(v || "").trim())
    .filter(v => v.length > 0)
    .slice(0, 5);
}

function validatePayload(parsed: any): BankPayload {
  const payload = {} as BankPayload;
  for (const section of SECTIONS) {
    payload[section] = normalizeVariations(parsed?.[section]);
  }
  return payload;
}

async function writeBankPayload(
  payload: BankPayload,
  serviceName: string,
  accountId: string,
  websiteId: string,
): Promise<{ written: string[]; errors: Record<string, string> }> {
  const written: string[] = [];
  const errors: Record<string, string> = {};

  for (const section of SECTIONS) {
    const variations = payload[section];
    if (!variations.length) {
      errors[section] = `No variations returned for ${section}`;
      continue;
    }

    try {
      await db.createVariationBank({
        accountId,
        websiteId,
        service: serviceName,
        sectionName: section,
        variations,
      });
      written.push(section);
    } catch (err: any) {
      errors[section] = err?.message ?? String(err);
    }
  }

  return { written, errors };
}

export async function writeVariationsForService(
  serviceName: string,
  accountId: string,
  websiteId: string,
  ctx?: BrandContext,
): Promise<{ written: string[]; errors: Record<string, string> }> {
  const prompt = buildBankPrompt(serviceName, ctx);
  const { text: raw, provider, promptTokens, completionTokens } = await callAI({
    prompt,
    maxTokens: 9000,
    temperature: 0.7,
  });

  try {
    await logApiUsage({
      accountId,
      websiteId,
      generationType: "variation_writing:full_core_bank",
      modelUsed: provider,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
    });
  } catch (logErr: any) {
    console.warn("[usage-logger] variation_writing log failed (non-fatal):", logErr?.message);
  }

  const json = extractBalancedJson(raw);
  if (!json) {
    throw new Error(`Claude did not return valid JSON for full variation bank. Response starts: ${raw.slice(0, 300)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch (err: any) {
    throw new Error(`Variation bank JSON parse failed: ${err?.message ?? String(err)}`);
  }

  const payload = validatePayload(parsed);
  const result = await writeBankPayload(payload, serviceName, accountId, websiteId);

  if (result.written.length === 0) {
    const firstError = Object.values(result.errors)[0] ?? "No core sections written";
    throw new Error(`Full bank write failed for "${serviceName}": ${firstError}`);
  }

  return result;
}

/**
 * Fill missing core bank sections. This still uses one Claude call per service:
 * it regenerates the full core bank, then saves only sections that are missing.
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

  if (missing.length === 0) {
    return { filled: [], skipped: skipped as string[], errors: [] };
  }

  const prompt = buildBankPrompt(serviceName, ctx);
  const { text: raw, provider, promptTokens, completionTokens } = await callAI({
    prompt,
    maxTokens: 9000,
    temperature: 0.7,
  });

  try {
    await logApiUsage({
      accountId,
      websiteId,
      generationType: "variation_writing:fill_missing_full_core_bank",
      modelUsed: provider,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
    });
  } catch (logErr: any) {
    console.warn("[usage-logger] variation_writing fill_missing log failed (non-fatal):", logErr?.message);
  }

  const json = extractBalancedJson(raw);
  if (!json) {
    throw new Error(`Claude did not return valid JSON for fill-missing variation bank. Response starts: ${raw.slice(0, 300)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch (err: any) {
    throw new Error(`Fill-missing variation bank JSON parse failed: ${err?.message ?? String(err)}`);
  }

  const payload = validatePayload(parsed);
  const filled: string[] = [];
  const errors: string[] = [];

  for (const section of missing) {
    const variations = payload[section];
    if (!variations.length) {
      errors.push(`${section}: no variations returned`);
      continue;
    }

    try {
      await db.createVariationBank({
        accountId,
        websiteId,
        service: serviceName,
        sectionName: section,
        variations,
      });
      filled.push(section);
    } catch (err: any) {
      errors.push(`${section}: ${err?.message ?? "unknown error"}`);
    }
  }

  return { filled, skipped: skipped as string[], errors };
}
