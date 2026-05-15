import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { pages } from "@shared/schema";
import { variationVersions } from "@shared/content-architecture-schema";

export interface SemanticAuditOptions {
  accountId?: string;
  websiteId?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface SemanticRiskResult {
  id: string;
  type: "variation" | "page";
  risk: "LOW" | "MEDIUM" | "HIGH";
  score: number;
  reasons: string[];
}

export interface SemanticAuditResult {
  audited: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  results: SemanticRiskResult[];
  dryRun: boolean;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "you", "your", "our", "can", "will", "have", "has", "had", "but", "not", "all", "any", "get", "more", "about", "into", "when", "where", "what", "why", "how", "who", "their", "they", "them", "then", "than", "also", "one", "two", "per", "via", "use", "using", "used", "service", "services"
]);

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 3 && !STOPWORDS.has(token));
}

function topTerms(text: string, limit = 20) {
  const counts = new Map<string, number>();

  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}

function jaccardSimilarity(a: string[], b: string[]) {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = Array.from(setA).filter((item) => setB.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function classifyRisk(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (score >= 0.72) return "HIGH";
  if (score >= 0.48) return "MEDIUM";
  return "LOW";
}

export async function auditVariationSemanticRisk(
  options: SemanticAuditOptions = {},
): Promise<SemanticAuditResult> {
  const limit = options.limit ?? 100;

  const candidates = await db
    .select({
      id: variationVersions.id,
      accountId: variationVersions.accountId,
      websiteId: variationVersions.websiteId,
      sectionId: variationVersions.sectionId,
      content: variationVersions.content,
    })
    .from(variationVersions)
    .where(
      and(
        eq(variationVersions.active, true),
        options.accountId ? eq(variationVersions.accountId, options.accountId) : undefined,
        options.websiteId ? eq(variationVersions.websiteId, options.websiteId) : undefined,
      ),
    )
    .limit(limit);

  const results: SemanticRiskResult[] = [];

  for (const candidate of candidates) {
    const candidateTerms = topTerms(candidate.content);

    const peers = await db
      .select({ id: variationVersions.id, content: variationVersions.content })
      .from(variationVersions)
      .where(
        and(
          ne(variationVersions.id, candidate.id),
          eq(variationVersions.accountId, candidate.accountId),
          eq(variationVersions.sectionId, candidate.sectionId),
          eq(variationVersions.active, true),
        ),
      )
      .limit(50);

    let maxSimilarity = 0;

    for (const peer of peers) {
      const similarity = jaccardSimilarity(candidateTerms, topTerms(peer.content));
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    const reasons: string[] = [];
    if (maxSimilarity >= 0.72) reasons.push("high_term_overlap_with_existing_variation");
    if (maxSimilarity >= 0.48 && maxSimilarity < 0.72) reasons.push("medium_term_overlap_with_existing_variation");
    if (candidateTerms.length < 8) reasons.push("thin_semantic_signal");

    const risk = classifyRisk(maxSimilarity);

    results.push({
      id: candidate.id,
      type: "variation",
      risk,
      score: Number(maxSimilarity.toFixed(4)),
      reasons,
    });

    if (!options.dryRun && risk !== "LOW") {
      await db
        .update(variationVersions)
        .set({
          uniquenessScore: Math.max(0, Math.round(100 - maxSimilarity * 100)),
          scoreVersion: "semantic-intelligence-v1",
          scoredAt: new Date(),
          scoreInputs: {
            semanticRisk: risk,
            semanticSimilarity: maxSimilarity,
            semanticReasons: reasons,
            topTerms: candidateTerms,
          },
          updatedAt: new Date(),
        })
        .where(eq(variationVersions.id, candidate.id));
    }
  }

  return summarize(results, Boolean(options.dryRun));
}

export async function auditPageCannibalizationRisk(
  options: SemanticAuditOptions = {},
): Promise<SemanticAuditResult> {
  const limit = options.limit ?? 100;

  const pageRows = await db
    .select({
      id: pages.id,
      websiteId: pages.websiteId,
      slug: pages.slug,
      title: pages.title,
      h1: pages.h1,
      metaDescription: pages.metaDescription,
      pageType: pages.pageType,
    })
    .from(pages)
    .where(options.websiteId ? eq(pages.websiteId, options.websiteId) : undefined)
    .limit(limit);

  const results: SemanticRiskResult[] = [];

  for (const page of pageRows) {
    const pageText = [page.slug, page.title, page.h1, page.metaDescription ?? ""].join(" ");
    const pageTerms = topTerms(pageText, 15);

    const peers = pageRows.filter((peer) => peer.id !== page.id && peer.websiteId === page.websiteId);
    let maxSimilarity = 0;

    for (const peer of peers) {
      const peerText = [peer.slug, peer.title, peer.h1, peer.metaDescription ?? ""].join(" ");
      const similarity = jaccardSimilarity(pageTerms, topTerms(peerText, 15));
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    const reasons: string[] = [];
    if (maxSimilarity >= 0.72) reasons.push("high_page_intent_overlap");
    if (maxSimilarity >= 0.48 && maxSimilarity < 0.72) reasons.push("medium_page_intent_overlap");
    if (pageTerms.length < 6) reasons.push("thin_page_intent_signal");

    const risk = classifyRisk(maxSimilarity);

    results.push({
      id: page.id,
      type: "page",
      risk,
      score: Number(maxSimilarity.toFixed(4)),
      reasons,
    });
  }

  return summarize(results, Boolean(options.dryRun));
}

function summarize(results: SemanticRiskResult[], dryRun: boolean): SemanticAuditResult {
  return {
    audited: results.length,
    highRisk: results.filter((item) => item.risk === "HIGH").length,
    mediumRisk: results.filter((item) => item.risk === "MEDIUM").length,
    lowRisk: results.filter((item) => item.risk === "LOW").length,
    results,
    dryRun,
  };
}
