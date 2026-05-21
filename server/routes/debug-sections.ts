import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import * as storage from "../storage";

/**
 * Debug route: GET /api/debug/page-sections/:websiteId/:slug
 *
 * Returns the raw section map for a page so we can verify exactly which
 * of the 14 expected sections are filled vs missing — without going
 * through the full render pipeline.
 *
 * Expected sections (14):
 *   1. Introduction / Overview
 *   2. Why Choose Us
 *   3. Our Process
 *   4. Services We Offer
 *   5. Benefits
 *   6. Industries We Serve
 *   7. Common Challenges
 *   8. How It Works
 *   9. Pricing / Plans
 *  10. Testimonials / Reviews
 *  11. Case Studies / Results
 *  12. FAQ
 *  13. Service Area
 *  14. Contact / Get Started
 */

const EXPECTED_SECTIONS = [
  "Introduction",
  "Why Choose",
  "Our Process",
  "Services We Offer",
  "Benefits",
  "Industries We Serve",
  "Common Challenges",
  "How It Works",
  "Pricing",
  "Testimonials",
  "Case Studies",
  "FAQ",
  "Service Area",
  "Contact",
];

function extractSections(html: string): string[] {
  const h2Pattern = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const sections: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = h2Pattern.exec(html)) !== null) {
    sections.push(m[1].replace(/<[^>]+>/g, "").trim());
  }
  return sections;
}

function matchExpected(found: string[], expected: string[]): { matched: string[]; missing: string[] } {
  const matched: string[] = [];
  const missing: string[] = [];
  for (const exp of expected) {
    const hit = found.find(s => s.toLowerCase().includes(exp.toLowerCase()));
    if (hit) matched.push(hit);
    else missing.push(exp);
  }
  return { matched, missing };
}

export function registerDebugSectionsRoute(app: Express): void {
  app.get(
    "/api/debug/page-sections/:websiteId/:slug",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { websiteId, slug } = req.params;

        const page = await storage.getPageBySlug(websiteId, slug);
        if (!page) return res.status(404).json({ error: "Page not found" });

        const version = await storage.getLatestPageVersion(page.id);
        if (!version) return res.status(404).json({ error: "No version found" });

        const html = version.contentHtml || "";
        const allSections = extractSections(html);
        const { matched, missing } = matchExpected(allSections, EXPECTED_SECTIONS);

        const placeholderPattern = /\[FILL\]|\[MISSING\]|TODO:|PLACEHOLDER/gi;
        const placeholders = (html.match(placeholderPattern) || []).length;

        return res.json({
          pageId: page.id,
          slug: page.slug,
          status: page.status,
          contentLength: html.length,
          totalH2Sections: allSections.length,
          allSections,
          expectedSections: {
            total: EXPECTED_SECTIONS.length,
            matched: matched.length,
            missing: missing.length,
            matchedList: matched,
            missingList: missing,
          },
          placeholderCount: placeholders,
          healthScore: Math.round((matched.length / EXPECTED_SECTIONS.length) * 100),
          flags: {
            isEmpty: html.length < 500,
            hasPlaceholders: placeholders > 0,
            missingMoreThanHalf: missing.length > EXPECTED_SECTIONS.length / 2,
          },
        });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }
  );
}
