export interface PageQualityInput {
  pageId: string;
  slug: string;
  title?: string | null;
  h1?: string | null;
  metaDescription?: string | null;
  contentHtml?: string | null;
}

export interface PageQualityIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface PageQualityResult {
  ok: boolean;
  issues: PageQualityIssue[];
}

const DUPLICATE_GEO_PATTERN = /\b([A-Z][A-Za-z .'-]+)\s*,\s*\1\b/g;
const UNRESOLVED_PLACEHOLDER_PATTERN = /\{[^{}]{1,100}\}/g;
const UNSAFE_PROOF_PATTERNS: Array<{ code: string; pattern: RegExp; message: string }> = [
  {
    code: "unsafe_thousands_claim",
    pattern: /\b(thousands of merchants|thousands of businesses)\b/i,
    message: "Content contains an unverifiable mass-proof claim such as 'thousands of merchants'.",
  },
  {
    code: "unsafe_uptime_claim",
    pattern: /\b99\.9%\s+uptime\b/i,
    message: "Content contains an unverifiable uptime guarantee.",
  },
  {
    code: "unsafe_exact_business_count",
    pattern: /\bfor\s+\d{1,3}(?:,\d{3})+\s+businesses\b/i,
    message: "Content contains an unverifiable exact local business-count claim.",
  },
  {
    code: "unsafe_real_merchant_data_claim",
    pattern: /\bbacked by real merchant data\b/i,
    message: "Content claims merchant-data proof without a verified source.",
  },
  {
    code: "unsafe_specific_lift_claim",
    pattern: /\b(?:average\s+)?(?:\d{2,3})%\s+(?:increase|lift|boost|drop|decrease|reduction)\b/i,
    message: "Content contains a specific performance percentage that must be verified before publishing.",
  },
];

function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDuplicateGeoPhrase(value: string | null | undefined): boolean {
  if (!value) return false;
  DUPLICATE_GEO_PATTERN.lastIndex = 0;
  return DUPLICATE_GEO_PATTERN.test(value);
}

function findPlaceholders(value: string | null | undefined): string[] {
  if (!value) return [];
  UNRESOLVED_PLACEHOLDER_PATTERN.lastIndex = 0;
  return Array.from(new Set(Array.from(value.matchAll(UNRESOLVED_PLACEHOLDER_PATTERN)).map((match) => match[0])));
}

function pushPlaceholderIssues(
  issues: PageQualityIssue[],
  field: "title" | "h1" | "meta" | "content",
  value: string | null | undefined,
) {
  const placeholders = findPlaceholders(value);
  if (placeholders.length === 0) return;

  issues.push({
    code: `unresolved_placeholder_${field}`,
    severity: "error",
    message: `Unresolved template placeholder(s) found in ${field}: ${placeholders.slice(0, 5).join(", ")}.`,
  });
}

function pushUnsafeProofIssues(issues: PageQualityIssue[], value: string | null | undefined) {
  if (!value) return;
  const plainText = stripHtml(value);

  for (const unsafe of UNSAFE_PROOF_PATTERNS) {
    if (unsafe.pattern.test(plainText)) {
      issues.push({
        code: unsafe.code,
        severity: "error",
        message: unsafe.message,
      });
    }
  }
}

function hasRequiredSeoBasics(input: PageQualityInput): PageQualityIssue[] {
  const issues: PageQualityIssue[] = [];

  if (!input.slug || input.slug.length < 3) {
    issues.push({ code: "missing_slug", severity: "error", message: "Page is missing a valid slug." });
  }

  if (!input.title || input.title.trim().length < 10) {
    issues.push({ code: "missing_title", severity: "error", message: "Page title is missing or too short." });
  }

  if (!input.h1 || input.h1.trim().length < 10) {
    issues.push({ code: "missing_h1", severity: "error", message: "Page H1 is missing or too short." });
  }

  if (!input.metaDescription || input.metaDescription.trim().length < 50) {
    issues.push({ code: "thin_meta_description", severity: "warning", message: "Meta description is missing or too short." });
  }

  const plainText = stripHtml(input.contentHtml ?? "");
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;

  if (wordCount < 250) {
    issues.push({ code: "thin_content", severity: "error", message: `Rendered content appears too thin (${wordCount} words).` });
  }

  return issues;
}

export function checkPageQuality(input: PageQualityInput): PageQualityResult {
  const issues: PageQualityIssue[] = [];

  issues.push(...hasRequiredSeoBasics(input));

  if (hasDuplicateGeoPhrase(input.title)) {
    issues.push({ code: "duplicate_geo_title", severity: "error", message: "Title contains duplicate geo phrase such as 'Alabama, Alabama'." });
  }

  if (hasDuplicateGeoPhrase(input.h1)) {
    issues.push({ code: "duplicate_geo_h1", severity: "error", message: "H1 contains duplicate geo phrase such as 'Alabama, Alabama'." });
  }

  if (hasDuplicateGeoPhrase(input.metaDescription)) {
    issues.push({ code: "duplicate_geo_meta", severity: "error", message: "Meta description contains duplicate geo phrase such as 'Alabama, Alabama'." });
  }

  if (hasDuplicateGeoPhrase(stripHtml(input.contentHtml ?? ""))) {
    issues.push({ code: "duplicate_geo_content", severity: "error", message: "Content contains duplicate geo phrase such as 'Alabama, Alabama'." });
  }

  pushPlaceholderIssues(issues, "title", input.title);
  pushPlaceholderIssues(issues, "h1", input.h1);
  pushPlaceholderIssues(issues, "meta", input.metaDescription);
  pushPlaceholderIssues(issues, "content", stripHtml(input.contentHtml ?? ""));

  pushUnsafeProofIssues(issues, input.title);
  pushUnsafeProofIssues(issues, input.h1);
  pushUnsafeProofIssues(issues, input.metaDescription);
  pushUnsafeProofIssues(issues, input.contentHtml);

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}
