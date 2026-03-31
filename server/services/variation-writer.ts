import Anthropic from "@anthropic-ai/sdk";
import * as db from "../storage";

const MODEL = "claude-haiku-4-5-20251001";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 150_000, maxRetries: 0 });

const SECTIONS = ["intro", "how_it_works", "benefits", "faq", "cta"] as const;
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

export async function writeVariationsForService(
  serviceName: string,
  accountId: string,
  websiteId: string,
  ctx?: BrandContext,
): Promise<void> {
  await Promise.all(
    SECTIONS.map(async (section) => {
      const prompt = SECTION_PROMPTS[section](serviceName, ctx);

      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
      });

      const raw = (message.content[0] as any).text as string;
      const variations = parseVariations(raw);

      if (variations.length === 0) {
        throw new Error(`No variations parsed for section "${section}" of service "${serviceName}"`);
      }

      await db.createVariationBank({
        accountId,
        websiteId,
        service: serviceName,
        sectionName: section,
        variations,
      });
    })
  );
}
