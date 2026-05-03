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

function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDuplicateGeoPhrase(value: string | null | undefined): boolean {
  if (!value) return false;
  DUPLICATE_GEO_PATTERN.lastIndex = 0;
  return DUPLICATE_GEO_PATTERN.test(value);
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

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}
