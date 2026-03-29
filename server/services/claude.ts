import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-3-5-haiku-20241022";

export interface GeneratedPage {
  title: string;
  metaDescription: string;
  h1: string;
  slug: string;
  contentHtml: string;
  wordCount: number;
  publishScore: number;
  localSignalScore: number;
  faqItems?: Array<{ question: string; answer: string }>;
  promptTokens: number;
  completionTokens: number;
}

export interface ReviewResult {
  passed: boolean;
  score: number;
  issues: string[];
  rewrittenHtml?: string;
  notes: string;
  promptTokens: number;
  completionTokens: number;
}

export interface PageContext {
  blueprintName: string;
  pageType: string;
  titleTemplate: string;
  metaDescTemplate: string;
  h1Template: string;
  slugTemplate: string;
  sections: any[];
  requiredWordCount: number;
  promptFamily: string;
  faqEnabled: boolean;
  locationName?: string;
  locationState?: string;
  locationSlug?: string;
  serviceName?: string;
  serviceSlug?: string;
  industryName?: string;
  brandName?: string;
  brandDescription?: string;
  brandPhone?: string;
  brandTagline?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  intentType?: string;
}

function interpolate(template: string, ctx: PageContext): string {
  return template
    .replace(/\{location\}/g, ctx.locationName || "")
    .replace(/\{state\}/g, ctx.locationState || "")
    .replace(/\{service\}/g, ctx.serviceName || "")
    .replace(/\{industry\}/g, ctx.industryName || "")
    .replace(/\{brand\}/g, ctx.brandName || "")
    .replace(/\{keyword\}/g, ctx.primaryKeyword || "")
    .replace(/-{2,}/g, "-")
    .trim();
}

function buildFirstPassPrompt(ctx: PageContext): string {
  const title = interpolate(ctx.titleTemplate, ctx);
  const h1 = interpolate(ctx.h1Template, ctx);
  const metaDesc = interpolate(ctx.metaDescTemplate, ctx);
  const slug = interpolate(ctx.slugTemplate, ctx)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const sections = ctx.sections.map((s: any) => `- ${s.name}: ${s.description || s.name}`).join("\n");

  return `You are an expert local SEO content writer. Generate a high-quality, locally-specific white-pages article.

PAGE DETAILS:
- Title: ${title}
- H1: ${h1}
- Meta Description: ${metaDesc}
- Slug: ${slug}
- Page Type: ${ctx.pageType}
- Target Word Count: ${ctx.requiredWordCount}+
${ctx.locationName ? `- Location: ${ctx.locationName}, ${ctx.locationState || ""}` : ""}
${ctx.serviceName ? `- Service: ${ctx.serviceName}` : ""}
${ctx.industryName ? `- Industry: ${ctx.industryName}` : ""}
${ctx.brandName ? `- Brand: ${ctx.brandName}` : ""}
${ctx.brandTagline ? `- Tagline: ${ctx.brandTagline}` : ""}
${ctx.primaryKeyword ? `- Primary Keyword: ${ctx.primaryKeyword}` : ""}
${ctx.secondaryKeywords?.length ? `- Secondary Keywords: ${ctx.secondaryKeywords.join(", ")}` : ""}

REQUIRED SECTIONS:
${sections || "- Introduction\n- Service Overview\n- Why Choose Us\n- Service Area\n- FAQ\n- Call to Action"}

INSTRUCTIONS:
1. Write at least ${ctx.requiredWordCount} words of unique, informative content
2. Include specific local details about ${ctx.locationName || "the area"} — neighborhoods, landmarks, local context
3. Use the primary keyword naturally 3-5 times
4. Each section must be distinct and add real value — no thin filler content
5. Write in a helpful, professional tone${ctx.brandTagline ? ` aligned with "${ctx.brandTagline}"` : ""}
6. Include specific local signals: street references, local landmarks, community context
${ctx.faqEnabled ? "7. Include a FAQ section with 4-6 relevant questions and detailed answers" : ""}

OUTPUT FORMAT (respond with valid JSON only):
{
  "title": "${title}",
  "metaDescription": "${metaDesc}",
  "h1": "${h1}",
  "slug": "${slug}",
  "contentHtml": "<full HTML content here with proper h2, p, ul tags>",
  "wordCount": <number>,
  "publishScore": <0.0-1.0 float, your honest quality assessment>,
  "localSignalScore": <0.0-1.0 float, how locally specific is the content>,
  "faqItems": [{"question": "...", "answer": "..."}]
}`;
}

function buildReviewPrompt(originalHtml: string, ctx: PageContext): string {
  return `You are an adversarial SEO editor reviewing a locally-targeted article. Be strict and honest.

REVIEW CRITERIA:
1. Word count >= ${ctx.requiredWordCount}
2. Local specificity — does it mention actual local details, not generic text?
3. Unique value — not thin, not duplicate-feeling
4. Keyword usage — natural, not stuffed
5. Professional and helpful tone
6. All required sections present and substantial
7. No factual errors or placeholder text

ORIGINAL CONTENT:
${originalHtml.substring(0, 6000)}

Respond with JSON:
{
  "passed": true/false,
  "score": <0.0-1.0>,
  "issues": ["list of specific issues found"],
  "notes": "brief overall assessment",
  "rewrittenHtml": "<only if failed: provide improved version>"
}`;
}

export interface GeneratedBlueprint {
  name: string;
  pageType: string;
  titleTemplate: string;
  metaDescTemplate: string;
  h1Template: string;
  slugTemplate: string;
  requiredWordCount: number;
  minPublishScore: string;
  faqEnabled: boolean;
  promptFamily: string;
  sections: Array<{ name: string; description: string }>;
}

export async function generateBlueprint(opts: {
  businessName: string;
  industry: string;
  serviceName?: string;
  pageType: string;
  extraContext?: string;
}): Promise<GeneratedBlueprint> {
  const { businessName, industry, serviceName, pageType, extraContext } = opts;

  const pageTypeLabels: Record<string, string> = {
    service_city: "Service + City (e.g. 'Credit Card Processing in Austin, TX')",
    state_hub: "State Hub (e.g. 'Merchant Services in Texas')",
    city_hub: "City Hub (e.g. 'Business Services in Houston')",
    industry_city: "Industry + City (e.g. 'Restaurant Payment Solutions in Chicago')",
    problem_intent: "Problem Intent (e.g. 'How to Accept Credit Cards for Small Business')",
  };

  const prompt = `You are an expert SEO strategist generating a page blueprint for a white-pages publishing platform.

BUSINESS DETAILS:
- Business Name: ${businessName}
- Industry: ${industry}
${serviceName ? `- Specific Service: ${serviceName}` : ""}
- Page Type: ${pageTypeLabels[pageType] || pageType}
${extraContext ? `- Extra Context: ${extraContext}` : ""}

TEMPLATE VARIABLES AVAILABLE:
- {service} — the service name (e.g. "Credit Card Processing")
- {location} — city name (e.g. "Austin")
- {state} — state name (e.g. "Texas")
- {brand} — business name
- {industry} — industry name

Generate a complete SEO-optimized blueprint for this page type. Think about what would actually rank well and convert visitors.

Respond ONLY with valid JSON in this exact format:
{
  "name": "<descriptive blueprint name>",
  "pageType": "${pageType}",
  "titleTemplate": "<SEO title using template vars, max 60 chars when rendered>",
  "metaDescTemplate": "<compelling meta description using template vars, max 160 chars when rendered>",
  "h1Template": "<main heading using template vars>",
  "slugTemplate": "<URL slug using template vars, lowercase-hyphenated>",
  "requiredWordCount": <700-1200 integer>,
  "minPublishScore": "<0.60-0.75 as string>",
  "faqEnabled": true,
  "promptFamily": "local_service",
  "sections": [
    { "name": "<section name>", "description": "<what Claude should write in this section, 1-2 sentences>" },
    ...4-7 sections total including intro, local content, service details, trust signals, FAQ, CTA...
  ]
}`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude did not return valid JSON");
  return JSON.parse(jsonMatch[0]) as GeneratedBlueprint;
}

export async function generateFirstPass(ctx: PageContext): Promise<GeneratedPage> {
  const prompt = buildFirstPassPrompt(ctx);

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Claude did not return valid JSON in first pass");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    title: parsed.title || interpolate(ctx.titleTemplate, ctx),
    metaDescription: parsed.metaDescription || "",
    h1: parsed.h1 || "",
    slug: parsed.slug || "",
    contentHtml: parsed.contentHtml || "",
    wordCount: parsed.wordCount || 0,
    publishScore: parseFloat(parsed.publishScore) || 0.5,
    localSignalScore: parseFloat(parsed.localSignalScore) || 0.5,
    faqItems: parsed.faqItems || [],
    promptTokens: message.usage.input_tokens,
    completionTokens: message.usage.output_tokens,
  };
}

export async function reviewAndRewrite(html: string, ctx: PageContext): Promise<ReviewResult> {
  const prompt = buildReviewPrompt(html, ctx);

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      passed: false,
      score: 0,
      issues: ["Failed to parse review response"],
      notes: "Review failed",
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    passed: Boolean(parsed.passed),
    score: parseFloat(parsed.score) || 0,
    issues: parsed.issues || [],
    rewrittenHtml: parsed.rewrittenHtml,
    notes: parsed.notes || "",
    promptTokens: message.usage.input_tokens,
    completionTokens: message.usage.output_tokens,
  };
}
