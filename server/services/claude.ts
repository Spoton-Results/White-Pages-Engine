import { callAI } from "./ai-provider";

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
  brandLegalName?: string;
  brandDescription?: string;
  brandPhone?: string;
  brandTagline?: string;
  brandVoiceAndTone?: string;
  brandYearsInBusiness?: string | number;
  brandLicenses?: string[];
  brandReviewSummary?: string;
  serviceDescription?: string;
  serviceProcessSteps?: string[];
  serviceTimeline?: string;
  bankSnippets?: Array<{ section: string; snippet: string }>;
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


// ─────────────────────────────────────────────────────────────────────────────
// First-pass prompt uses a DELIMITER format to avoid HTML-inside-JSON issues.
// Claude's HTML will never be embedded in a JSON string, eliminating escaping
// bugs (unescaped quotes in href/class attributes, etc.).
// ─────────────────────────────────────────────────────────────────────────────

// Phrases that signal generic AI output — explicitly forbidden
const FORBIDDEN_PHRASES = [
  "serving the community", "committed to excellence", "your trusted partner",
  "look no further", "second to none", "top-notch", "state-of-the-art",
  "cutting-edge", "industry-leading", "world-class", "comprehensive solutions",
  "tailored to your needs", "we pride ourselves", "we are proud to",
  "our dedicated team", "seamless experience", "delighted to serve",
  "customer satisfaction is our priority", "going above and beyond",
  "one-stop shop", "best-in-class", "unparalleled service",
  "we are here to help", "don't hesitate to contact",
];

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

  // Build business facts block — only include lines with actual data
  const businessFacts: string[] = [];
  if (ctx.brandLegalName) businessFacts.push(`Legal business name: ${ctx.brandLegalName}`);
  if (ctx.brandYearsInBusiness) businessFacts.push(`Years in business: ${ctx.brandYearsInBusiness}`);
  if (ctx.brandLicenses?.length) businessFacts.push(`Licenses / credentials: ${ctx.brandLicenses.join(", ")}`);
  if (ctx.brandReviewSummary) businessFacts.push(`Customer review summary: ${ctx.brandReviewSummary}`);
  if (ctx.brandPhone) businessFacts.push(`Contact phone: ${ctx.brandPhone}`);
  if (ctx.brandDescription) businessFacts.push(`Brand description: ${ctx.brandDescription}`);
  if (ctx.brandTagline) businessFacts.push(`Brand tagline: "${ctx.brandTagline}"`);

  // Build service facts block
  const serviceFacts: string[] = [];
  if (ctx.serviceDescription) serviceFacts.push(`Service overview: ${ctx.serviceDescription}`);
  if (ctx.serviceProcessSteps?.length) {
    serviceFacts.push(`How it works:\n${ctx.serviceProcessSteps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`);
  }
  if (ctx.serviceTimeline) serviceFacts.push(`Typical timeline: ${ctx.serviceTimeline}`);

  // Build bank snippets block — inject 1 variation per section as a style anchor
  const snippetBlock = ctx.bankSnippets?.length
    ? `APPROVED CONTENT SNIPPETS (use as style anchors — paraphrase and expand, do not copy verbatim):
${ctx.bankSnippets.map(s => `[${s.section}]: ${s.snippet}`).join("\n\n")}`
    : "";

  const voiceDirective = ctx.brandVoiceAndTone
    ? `BRAND VOICE & TONE: ${ctx.brandVoiceAndTone}`
    : "BRAND VOICE & TONE: Direct, confident, genuinely helpful. Speak like a knowledgeable local expert, not a corporate copywriter.";

  const locationLine = ctx.locationName
    ? `${ctx.locationName}${ctx.locationState ? `, ${ctx.locationState}` : ""}`
    : "the service area";

  return `You are a senior SEO content strategist and local service copywriter. Your content must satisfy Google's E-E-A-T guidelines (Experience, Expertise, Authoritativeness, Trustworthiness) and pass Google's Helpful Content evaluation — meaning it must be written primarily to genuinely help people, not just to rank.

═══════════════════════════════════════
PAGE ASSIGNMENT
═══════════════════════════════════════
Title:          ${title}
H1:             ${h1}
Meta Desc:      ${metaDesc}
Slug:           ${slug}
Page Type:      ${ctx.pageType}
Target Length:  ${ctx.requiredWordCount}+ words
Location:       ${locationLine}
${ctx.serviceName ? `Service:        ${ctx.serviceName}` : ""}
${ctx.industryName ? `Industry:       ${ctx.industryName}` : ""}
${ctx.primaryKeyword ? `Primary KW:     ${ctx.primaryKeyword}` : ""}
${ctx.secondaryKeywords?.length ? `Secondary KWs:  ${ctx.secondaryKeywords.join(", ")}` : ""}

═══════════════════════════════════════
BUSINESS INTELLIGENCE (use this — do not invent facts)
═══════════════════════════════════════
${businessFacts.length
  ? businessFacts.map(f => `• ${f}`).join("\n")
  : `• Business name: ${ctx.brandName || "this business"}\n• (Fill content from service specifics and location context below)`}

${serviceFacts.length ? `SERVICE SPECIFICS — explain the real process, not marketing fluff:\n${serviceFacts.map(f => `• ${f}`).join("\n")}` : ""}

${snippetBlock}

${voiceDirective}

═══════════════════════════════════════
REQUIRED SECTIONS
═══════════════════════════════════════
${sections || "- Introduction\n- How It Works\n- Why Choose This Business\n- Local Service Area\n- FAQ\n- Call to Action"}

═══════════════════════════════════════
E-E-A-T CONTENT REQUIREMENTS (Google ranks on these signals)
═══════════════════════════════════════
EXPERIENCE — Show first-hand knowledge of doing this work:
• Describe what actually happens during a service call / project — the real sequence of events
• Include details only someone who has performed this service would know (prep steps, common complications, what good vs poor results look like)
• Reference real scenarios: "When we see X, we typically do Y because Z"

EXPERTISE — Demonstrate deep subject-matter knowledge:
• Use precise industry terminology correctly — spell out acronyms, explain technical terms in plain language
• Address common misconceptions customers have about this service
• Include at least 2-3 specific data points, statistics, or industry facts that are verifiably true and relevant (e.g., typical cost ranges, code requirements, failure rates, timeframes)
• Explain the WHY behind your process, not just the WHAT

AUTHORITATIVENESS — Establish credibility for ${locationLine}:
• Reference the business's credentials, years in business, and specific expertise from the business facts above
• Name-drop the specific service area geography: neighborhoods, major roads, zip codes, or local landmarks people in ${ctx.locationName || "this area"} would recognize
• Mention local regulations, permit requirements, or area-specific considerations that affect this service

TRUSTWORTHINESS — Build confidence before the ask:
• Be honest about limitations: what this service does NOT cover, when they should call someone else
• Set realistic expectations: actual timeframes, what factors affect cost, what the customer needs to do to prepare
• Address price/cost questions directly — give ranges if possible, explain what drives price variation
• Include social proof signals: describe the type of customers served, outcomes achieved

═══════════════════════════════════════
GOOGLE HELPFUL CONTENT RULES (non-negotiable)
═══════════════════════════════════════
1. Write for the PERSON reading this, not for the search engine crawling it
2. Every paragraph must answer a real question or serve a real need — cut anything that is just filler
3. If you would not say something to a customer's face, do not write it
4. Do not summarize what you are about to say — just say it
5. Do not end sections with "Contact us to learn more" — give the information first, THEN the CTA
6. Write at least ${ctx.requiredWordCount} words. Depth and specificity are more valuable than length — reach the target through substance, not repetition

═══════════════════════════════════════
WRITING RULES
═══════════════════════════════════════
1. Use the primary keyword naturally 3-5 times. No stuffing. Use semantic variants and LSI terms.
2. Every factual claim must come from the business facts above OR be a verifiable industry standard — never invent company-specific facts
3. Be hyper-local: reference actual neighborhoods, cross-streets, landmarks, or local context specific to ${ctx.locationName || "the area"} that locals would recognize
4. Structure for scannability: use <h2> and <h3> subheadings that themselves answer questions (not just label topics)
5. Use <ul> and <li> for process steps, checklists, and comparison points — not for padding
${ctx.faqEnabled ? "6. FAQ section: 4-6 questions real customers actually type into Google. Answers must be specific, not generic — treat each as a mini-article" : ""}

ABSOLUTELY FORBIDDEN — using any of these phrases or close variants:
${FORBIDDEN_PHRASES.map(p => `"${p}"`).join(", ")}
Also forbidden: vague superlatives ("the best", "top-rated" without evidence), future-tense promises without specifics, and any sentence that could be copy-pasted onto a competitor's page unchanged.

═══════════════════════════════════════
OUTPUT FORMAT — use EXACTLY these delimiters
═══════════════════════════════════════
====TITLE====
${title}
====META====
${metaDesc}
====H1====
${h1}
====SLUG====
${slug}
====PUBLISH_SCORE====
<decimal 0.0-1.0 — your honest E-E-A-T quality assessment>
====LOCAL_SIGNAL_SCORE====
<decimal 0.0-1.0 — how locally specific and verifiable this content is>
====CONTENT====
<Full HTML article using <h2>, <h3>, <p>, <ul>, <li>. Write ALL ${ctx.requiredWordCount}+ words. Double quotes for HTML attributes. No markdown — pure HTML only.>
${ctx.faqEnabled ? `====FAQ====
<JSON array only: [{"question":"...","answer":"..."}]>` : ""}
====END====`;
}

function buildReviewPrompt(originalHtml: string, ctx: PageContext): string {
  return `You are a senior SEO quality editor applying Google's E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) standards and Helpful Content guidelines. Be strict — mediocre content that technically has enough words still fails.

REVIEW CRITERIA:
1. Word count >= ${ctx.requiredWordCount}
2. EXPERIENCE — Does it show first-hand knowledge of actually doing this work? (Real process details, real scenarios, insider knowledge)
3. EXPERTISE — Does it demonstrate deep subject-matter knowledge? (Precise terminology, specific data points, explains WHY not just WHAT)
4. AUTHORITATIVENESS — Does it establish credibility for this specific location and business? (Local geography, credentials, track record)
5. TRUSTWORTHINESS — Does it set honest expectations? (Real timeframes, cost factors, limitations, what NOT to expect)
6. Helpful Content — Is every paragraph genuinely useful to a person, or is it filler written for the search engine?
7. Local specificity — Does it reference real local details (neighborhoods, roads, landmarks) or is it generic text with a city name pasted in?
8. No forbidden filler phrases or generic corporate language
9. Natural keyword usage — primary keyword appears 3-5 times, no stuffing
10. All required sections are present and substantive

CONTENT TO REVIEW:
${originalHtml.substring(0, 6000)}

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "passed": true,
  "score": <0.0-1.0>,
  "issues": ["list of specific, actionable issues found"],
  "notes": "brief overall assessment focusing on E-E-A-T quality"
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

  const { text: raw } = await callAI({ prompt, maxTokens: 2000 });
  const jsonStr = extractJson(raw);
  if (!jsonStr) throw new Error("AI did not return valid JSON for suggestServices");
  return JSON.parse(jsonStr) as SuggestedService[];
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
  comparisonY?: string;
  customComparisonY?: string;
}): Promise<GeneratedBlueprint> {
  const { businessName, industry, serviceName, pageType, extraContext, comparisonY, customComparisonY } = opts;
  const approvedComparisonY =
    comparisonY === "other"
      ? (customComparisonY || "").trim()
      : comparisonY && comparisonY !== "auto"
        ? comparisonY.trim()
        : "";

  const pageTypeLabels: Record<string, string> = {
    service_city: "Service + City (e.g. 'Credit Card Processing in Austin, TX')",
    state_hub: "State Hub (e.g. 'Merchant Services in Texas')",
    city_hub: "City Hub (e.g. 'Business Services in Houston')",
    industry_city: "Industry + City (e.g. 'Restaurant Payment Solutions in Chicago')",
    state_service: "State + Service (e.g. 'Payment Processing in Texas')",
    industry_state: "Industry + State (e.g. 'Restaurant Payment Solutions in Texas')",
    problem_intent: "Problem Intent (e.g. 'How to Accept Credit Cards for Small Business')",
    service_problem: "Service + Problem (e.g. 'Payment Processing for Chargeback Problems')",
    city_service_problem: "City + Service + Problem (e.g. 'Houston Payment Processing for Chargeback Problems')",
    comparison: "X vs Y Comparison (e.g. 'Stripe vs Square for Small Businesses')",
  };

  const prompt = `You are an expert SEO strategist generating a page blueprint for a white-pages publishing platform.

BUSINESS DETAILS:
- Business Name: ${businessName}
- Industry: ${industry}
${serviceName ? `- Specific Service: ${serviceName}` : ""}
- Page Type: ${pageTypeLabels[pageType] || pageType}
${extraContext ? `- Extra Context: ${extraContext}` : ""}
${pageType === "comparison" ? `- Comparison X: ${businessName}` : ""}
${pageType === "comparison" && approvedComparisonY ? `- Approved Comparison Y: ${approvedComparisonY}` : ""}

TEMPLATE VARIABLES AVAILABLE:
- {service} — the service name (e.g. "Credit Card Processing")
- {location} — city name (e.g. "Austin")
- {state} — state name (e.g. "Texas")
- {brand} — business name
- {industry} — industry name
- {comparison_x} — the primary product, service, platform, or approach being compared
- {comparison_y} — the approved alternative being compared against
- {audience} — the intended customer, industry, or use case

${pageType === "comparison" ? `COMPARISON PAGE REQUIREMENTS:
- Use {comparison_x}, {comparison_y}, and {audience} in the title, H1, slug, and metadata.
- Treat X and Y neutrally. Do not invent performance, pricing, market-share, legal, compliance, or outcome claims.
- comparison_x is the business name: ${businessName}.
${approvedComparisonY ? `- comparison_y is the approved competitor: ${approvedComparisonY}.` : `- If no approved comparison_y is supplied, choose one of the top 3 most relevant real competitors for the supplied industry and service. Do not choose the business itself.`}
- When choosing comparison_y automatically, you MUST use a specific real company, software product, payment processor, POS platform, CRM, marketplace, or service competitor.
- Do NOT use generic placeholders such as "Competitor", "Alternative", "Provider", "Platform", "Solution", "Vendor", "Other Option", or "Comparison Y".
- The blueprint name, titleTemplate, h1Template, metaDescTemplate, slugTemplate, and section descriptions must reflect the same real comparison_y.
- Use the chosen comparison_y consistently throughout the blueprint.
- Include sections for:
  1. Quick Verdict
  2. Side-by-Side Overview
  3. Best Fit for {comparison_x}
  4. Best Fit for {comparison_y}
  5. Features and Capabilities
  6. Pricing Considerations
  7. Pros and Cons
  8. Final Recommendation
  9. Frequently Asked Questions
- Use promptFamily "comparison".
` : ""}

Generate a complete SEO-optimized blueprint for this page type.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "name": "<short blueprint name describing the page type and service, e.g. 'Credit Card Processing — Service + City' or 'Merchant Services State Hub'>",
  "pageType": "${pageType}",
  "titleTemplate": "<SEO title using template vars, max 60 chars when rendered>",
  "metaDescTemplate": "<compelling meta description using template vars, max 160 chars when rendered>",
  "h1Template": "<main heading using template vars>",
  "slugTemplate": "<URL slug using template vars, lowercase-hyphenated>",
  "requiredWordCount": <700-1200 integer>,
  "minPublishScore": "<0.60-0.75 as string>",
  "faqEnabled": true,
  "promptFamily": "${pageType === "comparison" ? "comparison" : "local_service"}",
  "sections": [
    { "name": "<section name>", "description": "<1-2 sentences>" }
  ]
}`;

  const { text: raw } = await callAI({ prompt, maxTokens: 1500 });
  const jsonStr = extractJson(raw);
  if (!jsonStr) throw new Error("AI did not return valid JSON for generateBlueprint");
  return JSON.parse(jsonStr) as GeneratedBlueprint;
}

export async function generateFirstPass(ctx: PageContext): Promise<GeneratedPage> {
  const prompt = buildFirstPassPrompt(ctx);

  const { text: raw, promptTokens, completionTokens } = await callAI({ prompt, maxTokens: 8000 });

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
      `AI returned no CONTENT section. Response starts: ${raw.substring(0, 300)}`
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
    promptTokens,
    completionTokens,
  };
}

export async function reviewAndRewrite(html: string, ctx: PageContext): Promise<ReviewResult> {
  const prompt = buildReviewPrompt(html, ctx);

  const { text: raw, promptTokens, completionTokens } = await callAI({ prompt, maxTokens: 1024 });
  const jsonStr = extractJson(raw);
  if (!jsonStr) {
    return {
      passed: true,
      score: 0.7,
      issues: [],
      notes: "Review parse failed — treating as passed",
      promptTokens,
      completionTokens,
    };
  }

  const parsed = JSON.parse(jsonStr);
  return {
    passed: Boolean(parsed.passed),
    score: parseFloat(parsed.score) || 0,
    issues: parsed.issues || [],
    rewrittenHtml: parsed.rewrittenHtml,
    notes: parsed.notes || "",
    promptTokens,
    completionTokens,
  };
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

  const { text: raw } = await callAI({ prompt, maxTokens: 3000 });
  const jsonStr = extractJson(raw);
  if (!jsonStr) throw new Error("AI did not return valid JSON for generateQueryClusters");
  const parsed = JSON.parse(jsonStr) as GeneratedCluster[];
  return parsed.map(c => ({
    name: c.name || "",
    intentType: (["transactional", "informational", "local", "navigational"].includes(c.intentType) ? c.intentType : "informational") as GeneratedCluster["intentType"],
    primaryKeyword: c.primaryKeyword || "",
    secondaryKeywords: Array.isArray(c.secondaryKeywords) ? c.secondaryKeywords : [],
    searchVolume: typeof c.searchVolume === "number" ? c.searchVolume : null,
    difficulty: typeof c.difficulty === "number" ? Math.min(100, Math.max(0, c.difficulty)) : null,
  }));
}
