import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { internalLinks, pages } from "@shared/schema";

export interface RelationshipIntelligenceOptions {
  websiteId?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface LinkOpportunity {
  fromPageId: string;
  toPageId: string;
  anchorText: string;
  reason: string;
  score: number;
}

export interface RelationshipAuditResult {
  pagesAudited: number;
  orphanPages: number;
  weakPages: number;
  opportunities: LinkOpportunity[];
  dryRun: boolean;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "near", "your", "you", "our", "are", "from", "that", "this", "service", "services", "page", "best", "top", "local"
]);

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length > 3 && !STOPWORDS.has(token));
}

function similarity(a: string, b: string) {
  const aTerms = new Set(tokenize(a));
  const bTerms = new Set(tokenize(b));
  const intersection = Array.from(aTerms).filter((term) => bTerms.has(term)).length;
  const union = new Set([...aTerms, ...bTerms]).size;
  return union === 0 ? 0 : intersection / union;
}

function anchorFromPage(page: { h1: string; title: string; slug: string }) {
  return page.h1 || page.title || page.slug.replace(/-/g, " ");
}

export async function auditRelationshipIntelligence(
  options: RelationshipIntelligenceOptions = {},
): Promise<RelationshipAuditResult> {
  const limit = options.limit ?? 250;

  const pageRows = await db
    .select({
      id: pages.id,
      websiteId: pages.websiteId,
      slug: pages.slug,
      title: pages.title,
      h1: pages.h1,
      pageType: pages.pageType,
      tier: pages.tier,
      qualityScore: pages.qualityScore,
      status: pages.status,
    })
    .from(pages)
    .where(options.websiteId ? eq(pages.websiteId, options.websiteId) : undefined)
    .limit(limit);

  const linkRows = await db
    .select({
      fromPageId: internalLinks.fromPageId,
      toPageId: internalLinks.toPageId,
    })
    .from(internalLinks)
    .where(options.websiteId ? eq(internalLinks.websiteId, options.websiteId) : undefined);

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const existingPairs = new Set<string>();

  for (const link of linkRows) {
    incoming.set(link.toPageId, (incoming.get(link.toPageId) ?? 0) + 1);
    outgoing.set(link.fromPageId, (outgoing.get(link.fromPageId) ?? 0) + 1);
    existingPairs.add(`${link.fromPageId}:${link.toPageId}`);
  }

  const orphanPages = pageRows.filter((page) => (incoming.get(page.id) ?? 0) === 0).length;
  const weakPages = pageRows.filter((page) => (incoming.get(page.id) ?? 0) + (outgoing.get(page.id) ?? 0) < 2).length;

  const opportunities: LinkOpportunity[] = [];

  for (const from of pageRows) {
    const fromText = `${from.slug} ${from.title} ${from.h1}`;

    const candidates = pageRows
      .filter((to) => to.id !== from.id && !existingPairs.has(`${from.id}:${to.id}`))
      .map((to) => {
        const toText = `${to.slug} ${to.title} ${to.h1}`;
        const semanticScore = similarity(fromText, toText);
        const authorityBoost = to.tier === 1 ? 0.2 : to.tier === 2 ? 0.1 : 0;
        const orphanBoost = (incoming.get(to.id) ?? 0) === 0 ? 0.15 : 0;
        return {
          to,
          score: semanticScore + authorityBoost + orphanBoost,
          semanticScore,
        };
      })
      .filter((candidate) => candidate.score >= 0.28)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const candidate of candidates) {
      opportunities.push({
        fromPageId: from.id,
        toPageId: candidate.to.id,
        anchorText: anchorFromPage(candidate.to),
        reason: `semantic=${candidate.semanticScore.toFixed(2)} incoming=${incoming.get(candidate.to.id) ?? 0} tier=${candidate.to.tier}`,
        score: Number(candidate.score.toFixed(4)),
      });
    }
  }

  return {
    pagesAudited: pageRows.length,
    orphanPages,
    weakPages,
    opportunities: opportunities.sort((a, b) => b.score - a.score).slice(0, 100),
    dryRun: Boolean(options.dryRun),
  };
}

export async function applyRelationshipOpportunities(options: RelationshipIntelligenceOptions = {}) {
  const audit = await auditRelationshipIntelligence(options);

  if (options.dryRun) return { ...audit, inserted: 0 };

  let inserted = 0;

  for (const opportunity of audit.opportunities) {
    const fromPage = await db
      .select({ websiteId: pages.websiteId })
      .from(pages)
      .where(eq(pages.id, opportunity.fromPageId))
      .limit(1);

    if (!fromPage[0]?.websiteId) continue;

    try {
      await db.insert(internalLinks).values({
        websiteId: fromPage[0].websiteId,
        fromPageId: opportunity.fromPageId,
        toPageId: opportunity.toPageId,
        anchorText: opportunity.anchorText,
        linkType: "semantic_opportunity",
      });
      inserted++;
    } catch {
      // Ignore duplicate/race errors; this script is safe to rerun.
    }
  }

  return { ...audit, inserted };
}
