import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-haiku-4-5-20251001";

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

/** Extract a named section from a delimited response */
function extractSection(raw: string, name: string): string {
  const startMarker = `====${name}====`;
  const start = raw.indexOf(startMarker);
  if (start === -1) return "";
  const contentStart = start + startMarker.length;
  // Find the next ==== marker
  const nextMarker = raw.indexOf("====", contentStart);
  const content = nextMarker === -1
    ? raw.substring(contentStart)
    : raw.substring(contentStart, nextMarker);
  return content.trim();
}

/** Count words in an HTML string */
function countWordsInHtml(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return 0;
  return text.split(" ").filter(Boolean).length;
}

/** Find the balanced closing bracket/brace, returning the substring from `start` inclusive */
function extractBalanced(text: string, startChar: string): string | null {
  const endChar = startChar === "{" ? "}" : "]";
  const start = text.indexOf(startChar);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === startChar) depth++;
    else if (ch === endChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Strip markdown code fences and extract the first JSON object or array */
function extractJson(raw: string): string | null {
  const stripped = raw
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  // Try object first, then array
  const objStart = stripped.indexOf("{");
  const arrStart = stripped.indexOf("[");
  const tryObj = objStart !== -1 && (arrStart === -1 || objStart < arrStart);
  if (tryObj) {
    const obj = extractBalanced(stripped, "{");
    if (obj) return obj;
  }
  const arr = extractBalanced(stripped, "[");
  if (arr) return arr;
  // Fallback: try object if array failed
  const obj = extractBalanced(stripped, "{");
  return obj;
}

/** Retry wrapper — handles transient overload / rate-limit errors */
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 3000,
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isRetryable =
        err?.status === 429 ||
        err?.status === 529 ||
        err?.status >= 500 ||
        err?.message?.includes("overloaded") ||
        err?.message?.includes("rate_limit");
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// First-pass prompt uses a DELIMITER format to avoid HTML-inside-JSON issues.
// Claude's HTML will never be embedded in a JSON string, eliminating escaping
// bugs (unescaped quotes in href/class attributes, etc.).
// ─────────────────────────────────────────────────────────────────────────────

function buildFirstPassPrompt(ctx: PageContext): string {
  const title = interpolate(ctx.titleTemplate, ctx);
  const h1 = interpolate(ctx.h1Template, ctx);
  const metaDesc = interpolate(ctx.metaDescTemplate, ctx);
  const slug = interpolate(ctx.slugTemplate, ctx)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const sections = ctx.sections
    .map((s: any) => `- ${s.name}: ${s.description || s.name}`)
    .join("\n");

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

IMPORTANT — OUTPUT FORMAT:
Use EXACTLY these delimiters (four equals signs, name, four equals signs). Output nothing outside them.

====TITLE====
${title}
====META====
${metaDesc}
====H1====
${h1}
====SLUG====
${slug}
====PUBLISH_SCORE====
<a decimal 0.0-1.0 representing your honest quality assessment>
====LOCAL_SIGNAL_SCORE====
<a decimal 0.0-1.0 representing how locally specific this content is>
====CONTENT====
<Write the full HTML article here using <h2>, <p>, <ul>, <li> tags. Write ALL ${ctx.requiredWordCount}+ words. Use double quotes for HTML attributes.>
${ctx.faqEnabled ? `====FAQ====
<A JSON array of FAQ objects: [{"question":"...","answer":"..."}]>` : ""}
====END====`;
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

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "passed": true,
  "score": <0.0-1.0>,
  "issues": ["list of specific issues found"],
  "notes": "brief overall assessment"
}`;
}

export interface SuggestedService {
  name: string;
  slug: string;
  description: string;
  keywords: string[];
}

export async function suggestServices(opts: {
  businessName: string;
  websiteUrl?: string;
  industry: string;
  existingServices?: string[];
}): Promise<SuggestedService[]> {
  const { businessName, websiteUrl, industry, existingServices = [] } = opts;

  const prompt = `You are an expert local SEO strategist. Suggest a complete list of services for a business.

BUSINESS DETAILS:
- Business Name: ${businessName}
- Industry: ${industry}
${websiteUrl ? `- Website: ${websiteUrl}` : ""}
${existingServices.length > 0 ? `- Already has these services (do NOT repeat them): ${existingServices.join(", ")}` : ""}

Generate 6-10 distinct services this business should have pages for. Think about what customers actually search for.

For each service:
- name: Clear, customer-friendly service name
- slug: lowercase-hyphenated URL slug
- description: 1-2 sentence description of the service
- keywords: 4-6 SEO search terms customers use to find this service

Respond ONLY with a JSON array (no markdown, no code fences):
[
  {
    "name": "Service Name",
    "slug": "service-name",
    "description": "What this service is and who it's for.",
    "keywords": ["keyword 1", "keyword 2", "keyword 3", "keyword 4"]
  }
]`;

  return callWithRetry(async () => {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonStr = extractJson(raw);
    if (!jsonStr) throw new Error("Claude did not return valid JSON");
    return JSON.parse(jsonStr) as SuggestedService[];
  });
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

Generate a complete SEO-optimized blueprint for this page type.

Respond ONLY with valid JSON (no markdown, no code fences):
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
    { "name": "<section name>", "description": "<1-2 sentences>" }
  ]
}`;

  return callWithRetry(async () => {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonStr = extractJson(raw);
    if (!jsonStr) throw new Error("Claude did not return valid JSON");
    return JSON.parse(jsonStr) as GeneratedBlueprint;
  });
}

export async function generateFirstPass(ctx: PageContext): Promise<GeneratedPage> {
  const prompt = buildFirstPassPrompt(ctx);

  return callWithRetry(async () => {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";

    // Parse using section delimiters — no JSON for the HTML content
    const title = extractSection(raw, "TITLE") || interpolate(ctx.titleTemplate, ctx);
    const metaDescription = extractSection(raw, "META") || "";
    const h1 = extractSection(raw, "H1") || "";
    const slug = (extractSection(raw, "SLUG") || "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const publishScore = Math.min(1, Math.max(0, parseFloat(extractSection(raw, "PUBLISH_SCORE")) || 0.5));
    const localSignalScore = Math.min(1, Math.max(0, parseFloat(extractSection(raw, "LOCAL_SIGNAL_SCORE")) || 0.5));
    const contentHtml = extractSection(raw, "CONTENT");
    const faqRaw = extractSection(raw, "FAQ");

    if (!contentHtml) {
      throw new Error(
        `Claude returned no CONTENT section. Response starts: ${raw.substring(0, 300)}`
      );
    }

    let faqItems: Array<{ question: string; answer: string }> = [];
    if (faqRaw) {
      try {
        const jsonStr = extractJson(faqRaw) || faqRaw;
        faqItems = JSON.parse(jsonStr);
      } catch {
        // FAQ parse failure is non-fatal
      }
    }

    return {
      title,
      metaDescription,
      h1,
      slug,
      contentHtml,
      wordCount: countWordsInHtml(contentHtml),
      publishScore,
      localSignalScore,
      faqItems,
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
    };
  });
}

export async function reviewAndRewrite(html: string, ctx: PageContext): Promise<ReviewResult> {
  const prompt = buildReviewPrompt(html, ctx);

  return callWithRetry(async () => {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonStr = extractJson(raw);
    if (!jsonStr) {
      return {
        passed: true,
        score: 0.7,
        issues: [],
        notes: "Review parse failed — treating as passed",
        promptTokens: message.usage.input_tokens,
        completionTokens: message.usage.output_tokens,
      };
    }

    const parsed = JSON.parse(jsonStr);
    return {
      passed: Boolean(parsed.passed),
      score: parseFloat(parsed.score) || 0,
      issues: parsed.issues || [],
      rewrittenHtml: parsed.rewrittenHtml,
      notes: parsed.notes || "",
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
    };
  });
}

// ── Query Cluster Generation ──────────────────────────────────────────────────

export interface GeneratedCluster {
  name: string;
  intentType: "transactional" | "informational" | "local" | "navigational";
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchVolume: number | null;
  difficulty: number | null;
}

export async function generateQueryClusters(opts: {
  businessName: string;
  industry: string;
  services: string[];
  existingClusters: string[];
}): Promise<GeneratedCluster[]> {
  const { businessName, industry, services, existingClusters } = opts;

  const prompt = `You are an expert local SEO strategist specializing in keyword clustering for multi-location service businesses.

BUSINESS DETAILS:
- Business Name: ${businessName}
- Industry: ${industry}
${services.length > 0 ? `- Services: ${services.join(", ")}` : ""}
${existingClusters.length > 0 ? `- Already has these clusters (do NOT repeat): ${existingClusters.join(", ")}` : ""}

Generate 10-15 query clusters that cover the full range of search intent for this business. Spread across all intent types:
- transactional: ready-to-buy searches ("merchant services near me", "get a pos system")
- informational: research searches ("how to reduce credit card fees", "what is a payment processor")
- local: geo-specific searches ("merchant services in [city]", "local payment processor")
- navigational: brand/comparison searches ("best merchant services", "square vs stripe comparison")

For each cluster output:
- name: Short descriptive label (3-5 words)
- intentType: one of transactional, informational, local, navigational
- primaryKeyword: The single best target keyword phrase
- secondaryKeywords: 3-5 related variants
- searchVolume: Estimated monthly US search volume (realistic integer, null if unknown)
- difficulty: SEO difficulty 0-100 (realistic, null if unknown)

Respond ONLY with a JSON array (no markdown, no code fences):
[
  {
    "name": "Cluster Name",
    "intentType": "transactional",
    "primaryKeyword": "primary keyword phrase",
    "secondaryKeywords": ["variant 1", "variant 2", "variant 3"],
    "searchVolume": 2400,
    "difficulty": 42
  }
]`;

  return callWithRetry(async () => {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonStr = extractJson(raw);
    if (!jsonStr) throw new Error("Claude did not return valid JSON");
    const parsed = JSON.parse(jsonStr) as GeneratedCluster[];
    return parsed.map(c => ({
      name: c.name || "",
      intentType: (["transactional", "informational", "local", "navigational"].includes(c.intentType) ? c.intentType : "informational") as GeneratedCluster["intentType"],
      primaryKeyword: c.primaryKeyword || "",
      secondaryKeywords: Array.isArray(c.secondaryKeywords) ? c.secondaryKeywords : [],
      searchVolume: typeof c.searchVolume === "number" ? c.searchVolume : null,
      difficulty: typeof c.difficulty === "number" ? Math.min(100, Math.max(0, c.difficulty)) : null,
    }));
  });
}
