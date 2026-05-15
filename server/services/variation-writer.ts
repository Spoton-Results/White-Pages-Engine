import * as db from "../storage";
import { logApiUsage } from "./usage-logger";
import { callAI } from "./ai-provider";

const CORE_SECTIONS = ["intro", "how_it_works", "benefits", "faq", "cta"] as const;
export const VARIATION_BANK_SECTION_COUNT = CORE_SECTIONS.length;
const SECTIONS = CORE_SECTIONS;
type Section = typeof SECTIONS[number];

export interface BrandContext {
  brandName?: string;
  brandDescription?: string;
  voiceAndTone?: string;
  industryName?: string;
  industryDescription?: string;
}

function buildContextBlock(service: string, ctx?: BrandContext): string {
  if (!ctx || (!ctx.brandName && !ctx.industryName)) return "";
  const lines: string[] = ["BUSINESS CONTEXT (use this to write accurate, branded content):"];
  if (ctx.brandName) lines.push(`- Brand: ${ctx.brandName}`);
  if (ctx.brandDescription) lines.push(`- About: ${ctx.brandDescription}`);
  if (ctx.voiceAndTone) lines.push(`- Voice & Tone: ${ctx.voiceAndTone}`);
  if (ctx.industryName) lines.push(`- Industry: ${ctx.industryName}`);
  if (ctx.industryDescription) lines.push(`- Industry Description: ${ctx.industryDescription}`);
  lines.push(`- Service being promoted: ${service}`);
  lines.push("");
  return lines.join("\n");
}

const SECTION_PROMPTS: Record<Section, (service: string, ctx?: BrandContext) => string> = {
  intro: (service, ctx) => `${buildContextBlock(service, ctx)}Write 5 distinct intro sections for a local SEO page about "${service}".

Each intro = 2 HTML paragraphs (~120-150 words total). Use EXACTLY these placeholders:
{{service}} {{city}} {{state}} {{state_abbr}} {{landmark}} {{business_culture}}

CRITICAL: NEVER use literal city names, state names, or specific geographic references. ONLY use the {{placeholders}} above. The content must be location-agnostic so it works for ANY city/state when placeholders are replaced. Do not mention any real city, state, region, or landmark by name — always use {{city}}, {{state}}, {{state_abbr}}, or {{landmark}} instead.

Each variation must open differently: vary tone, hook, and angle. No filler phrases like "In today's world".
${ctx?.voiceAndTone ? `Match this voice and tone: ${ctx.voiceAndTone}` : ""}

Format EXACTLY as shown — no text outside delimiters:
====VARIATION_1====
<p>...</p>
<p>...</p>
====VARIATION_2====
<p>...</p>
<p>...</p>
====VARIATION_3====
<p>...</p>
<p>...</p>
====VARIATION_4====
<p>...</p>
<p>...</p>
====VARIATION_5====
<p>...</p>
<p>...</p>`,

  how_it_works: (service, ctx) => `${buildContextBlock(service, ctx)}Write 5 distinct "how it works" sections for a "${service}" service page.

Each section = 3 HTML paragraphs (~180-220 words total). Use EXACTLY these placeholders:
{{service}} {{city}} {{state}} {{brand}} {{business_count}}

CRITICAL: NEVER use literal city names, state names, or specific geographic references. ONLY use the {{placeholders}} above. The content must be location-agnostic so it works for ANY city/state when placeholders are replaced.

Describe the process from first contact to implementation. Each variation must use a different structure or emphasis.
${ctx?.industryName ? `This is for the ${ctx.industryName} industry — make the process steps accurate for this industry.` : ""}

Format EXACTLY as shown — no text outside delimiters:
====VARIATION_1====
<p>...</p>
<p>...</p>
<p>...</p>
====VARIATION_2====
<p>...</p>
<p>...</p>
<p>...</p>
====VARIATION_3====
<p>...</p>
<p>...</p>
<p>...</p>
====VARIATION_4====
<p>...</p>
<p>...</p>
<p>...</p>
====VARIATION_5====
<p>...</p>
<p>...</p>
<p>...</p>`,

  benefits: (service, ctx) => `${buildContextBlock(service, ctx)}Write 5 distinct "benefits" sections for a "${service}" service page.

Each section = 4 HTML paragraphs with bold lead sentences (~200-240 words total). Use EXACTLY:
{{service}} {{city}} {{state}} {{brand}} {{payment_regulations}}

CRITICAL: NEVER use literal city names, state names, or specific geographic references. ONLY use the {{placeholders}} above. The content must be location-agnostic so it works for ANY city/state when placeholders are replaced.

Each paragraph should highlight a different benefit. Vary which benefits are featured.
${ctx?.industryName ? `Focus on benefits that matter most to ${ctx.industryName} businesses.` : ""}

Format EXACTLY as shown — no text outside delimiters:
====VARIATION_1====
<p><strong>Benefit one.</strong> ...</p>
<p><strong>Benefit two.</strong> ...</p>
<p><strong>Benefit three.</strong> ...</p>
<p><strong>Benefit four.</strong> ...</p>
====VARIATION_2====
<p><strong>Benefit one.</strong> ...</p>
<p><strong>Benefit two.</strong> ...</p>
<p><strong>Benefit three.</strong> ...</p>
<p><strong>Benefit four.</strong> ...</p>
====VARIATION_3====
<p><strong>Benefit one.</strong> ...</p>
<p><strong>Benefit two.</strong> ...</p>
<p><strong>Benefit three.</strong> ...</p>
<p><strong>Benefit four.</strong> ...</p>
====VARIATION_4====
<p><strong>Benefit one.</strong> ...</p>
<p><strong>Benefit two.</strong> ...</p>
<p><strong>Benefit three.</strong> ...</p>
<p><strong>Benefit four.</strong> ...</p>
====VARIATION_5====
<p><strong>Benefit one.</strong> ...</p>
<p><strong>Benefit two.</strong> ...</p>
<p><strong>Benefit three.</strong> ...</p>
<p><strong>Benefit four.</strong> ...</p>`,

  faq: (service, ctx) => `${buildContextBlock(service, ctx)}Write 5 distinct FAQ sections for a "${service}" service page, each with 5 Q&A pairs.

Each FAQ section = 5 questions with answers (~240-280 words total). Use EXACTLY:
{{service}} {{city}} {{state}} {{brand}} {{payment_regulations}}

CRITICAL: NEVER use literal city names, state names, or specific geographic references. ONLY use the {{placeholders}} above. The content must be location-agnostic so it works for ANY city/state when placeholders are replaced.

Use different questions across variations. Format each pair as:
<p><strong>Q: Question?</strong></p>
<p>Answer.</p>
${ctx?.industryName ? `Write questions that ${ctx.industryName} business owners actually ask.` : ""}

Format EXACTLY as shown — no text outside delimiters:
====VARIATION_1====
<p><strong>Q: ...</strong></p>
<p>...</p>
... (5 pairs)
====VARIATION_2====
<p><strong>Q: ...</strong></p>
<p>...</p>
... (5 pairs)
====VARIATION_3====
<p><strong>Q: ...</strong></p>
<p>...</p>
... (5 pairs)
====VARIATION_4====
<p><strong>Q: ...</strong></p>
<p>...</p>
... (5 pairs)
====VARIATION_5====
<p><strong>Q: ...</strong></p>
<p>...</p>
... (5 pairs)`,

  cta: (service, ctx) => `${buildContextBlock(service, ctx)}Write 5 distinct CTA (call-to-action) closing paragraphs for a "${service}" service page.

Each CTA = 1 HTML paragraph (~60-80 words). Use EXACTLY:
{{service}} {{city}} {{state}} {{brand}}

CRITICAL: NEVER use literal city names, state names, or specific geographic references. ONLY use the {{placeholders}} above. The content must be location-agnostic so it works for ANY city/state when placeholders are replaced.

Each must end with a strong action prompt. Vary the angle: urgency, trust, value, ease, results.
${ctx?.voiceAndTone ? `Match this voice and tone: ${ctx.voiceAndTone}` : ""}

Format EXACTLY as shown — no text outside delimiters:
====VARIATION_1====
<p>...</p>
====VARIATION_2====
<p>...</p>
====VARIATION_3====
<p>...</p>
====VARIATION_4====
<p>...</p>
====VARIATION_5====
<p>...</p>`,
};

function parseVariations(raw: string): string[] {
  const results: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const start = raw.indexOf(`====VARIATION_${i}====`);
    const end = i < 5 ? raw.indexOf(`====VARIATION_${i + 1}====`) : raw.length;
    if (start === -1) continue;
    const content = raw.slice(start + `====VARIATION_${i}====`.length, end).trim();
    if (content) results.push(content);
  }
  return results;
}

async function writeSingleSection(
  section: Section,
  serviceName: string,
  accountId: string,
  websiteId: string,
  ctx?: BrandContext,
): Promise<void> {
  const prompt = SECTION_PROMPTS[section](serviceName, ctx);
  const { text: raw, provider, promptTokens, completionTokens } = await callAI({ prompt, maxTokens: 2500 });

  try {
    await logApiUsage({
      accountId,
      websiteId,
      generationType: `variation_writing:${section}`,
      modelUsed: provider,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
    });
  } catch (logErr: any) {
    console.warn("[usage-logger] variation_writing log failed (non-fatal):", logErr?.message);
  }

  const variations = parseVariations(raw);
  if (variations.length === 0) {
    throw new Error(`No variations parsed for section "${section}" of service "${serviceName}"`);
  }

  await db.createVariationBank({ accountId, websiteId, service: serviceName, sectionName: section, variations });
}

export async function writeVariationsForService(
  serviceName: string,
  accountId: string,
  websiteId: string,
  ctx?: BrandContext,
): Promise<{ written: string[]; errors: Record<string, string> }> {
  const written: string[] = [];
  const errors: Record<string, string> = {};

  for (const section of SECTIONS) {
    try {
      await writeSingleSection(section, serviceName, accountId, websiteId, ctx);
      written.push(section);
    } catch (err: any) {
      errors[section] = err?.message ?? String(err);
      console.error(`[variation-writer] Section "${section}" failed for "${serviceName}":`, errors[section]);
    }
  }

  if (written.length === 0) {
    const firstError = Object.values(errors)[0] ?? "All core sections failed";
    throw new Error(`All ${VARIATION_BANK_SECTION_COUNT} core sections failed for "${serviceName}": ${firstError}`);
  }

  return { written, errors };
}

/**
 * Write only the core sections that are currently missing for this service.
 * Sections that already have variations are skipped.
 * Returns which sections were filled and which were skipped.
 */
export async function fillMissingSectionsForService(
  serviceName: string,
  accountId: string,
  websiteId: string,
  ctx?: BrandContext,
): Promise<{ filled: string[]; skipped: string[]; errors: string[] }> {
  const existing = await db.getVariationBanks(websiteId, serviceName);
  const existingSet = new Set(existing.map((b: any) => b.sectionName));

  const toFill = SECTIONS.filter(s => !existingSet.has(s));
  const skipped = SECTIONS.filter(s => existingSet.has(s));
  const filled: string[] = [];
  const errors: string[] = [];

  for (const section of toFill) {
    try {
      await writeSingleSection(section, serviceName, accountId, websiteId, ctx);
      filled.push(section);
    } catch (err: any) {
      errors.push(`${section}: ${err?.message ?? "unknown error"}`);
    }
  }

  return { filled, skipped: skipped as string[], errors };
}
