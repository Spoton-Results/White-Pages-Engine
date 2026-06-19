import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";

const router = Router();

const SORTS: Record<string, string> = {
  newest: "p.published_at DESC NULLS LAST, p.updated_at DESC NULLS LAST",
  updated: "p.updated_at DESC NULLS LAST",
  title: "p.title ASC",
  slug: "p.slug ASC",
  score: "p.quality_score DESC NULLS LAST",
  score_asc: "p.quality_score ASC NULLS LAST",
  words: "p.word_count DESC NULLS LAST",
  words_asc: "p.word_count ASC NULLS LAST",
  tier: "p.tier ASC NULLS LAST, p.quality_score DESC NULLS LAST",
};

function intParam(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function textParam(value: unknown) {
  return String(value || "").trim();
}

function rowToPage(row: any) {
  return {
    id: row.id,
    websiteId: row.website_id,
    blueprintId: row.blueprint_id,
    locationId: row.location_id,
    serviceId: row.service_id,
    pageType: row.page_type,
    slug: row.slug,
    title: row.title,
    metaDescription: row.meta_description,
    h1: row.h1,
    status: row.status,
    wordCount: row.word_count,
    tier: row.tier,
    qualityScore: row.quality_score,
    trustScore: row.trust_score,
    evidenceScore: row.evidence_score,
    contentQualityScore: row.content_quality_score,
    noindex: row.noindex,
    isDraft: row.is_draft,
    duplicateFlag: row.duplicate_flag,
    gscSubmittedAt: row.gsc_submitted_at,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    serviceName: row.service_name,
    locationName: row.location_name,
    locationState: row.location_state,
    blueprintName: row.blueprint_name,
  };
}

router.get("/api/websites/:websiteId/pages/search", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const websiteId = req.params.websiteId;
    const q = textParam(req.query.q).toLowerCase();
    const includeDrafts = textParam(req.query.includeDrafts) === "true";
    const status = includeDrafts ? "all" : (textParam(req.query.status) || "published");
    const pageType = textParam(req.query.pageType);
    const tier = textParam(req.query.tier);
    const scoreMin = textParam(req.query.scoreMin);
    const scoreMax = textParam(req.query.scoreMax);
    const wordsMin = textParam(req.query.wordsMin);
    const wordsMax = textParam(req.query.wordsMax);
    const service = textParam(req.query.service).toLowerCase();
    const location = textParam(req.query.location).toLowerCase();
    const eeat = textParam(req.query.eeat);
    const indexed = textParam(req.query.indexed);
    const sort = SORTS[textParam(req.query.sort)] ? textParam(req.query.sort) : "newest";
    const limit = intParam(req.query.limit, 50, 10, 250);
    const page = intParam(req.query.page, 1, 1, 100000);
    const offset = (page - 1) * limit;

    const where: string[] = ["p.website_id::text = $1::text"];
    const values: any[] = [websiteId];
    let i = 2;

    if (status && status !== "all") {
      if (status === "drafts") where.push("(p.status = 'draft' OR p.is_draft = true)");
      else { where.push(`p.status = $${i++}`); values.push(status); }
    }
    if (q) {
      where.push(`(lower(p.title) LIKE $${i} OR lower(p.slug) LIKE $${i} OR lower(COALESCE(p.h1,'')) LIKE $${i} OR lower(COALESCE(p.meta_description,'')) LIKE $${i})`);
      values.push(`%${q}%`); i++;
    }
    if (pageType && pageType !== "all") { where.push(`p.page_type = $${i++}`); values.push(pageType); }
    if (tier && tier !== "all") { where.push(`p.tier = $${i++}`); values.push(Number(tier)); }
    if (scoreMin !== "") { where.push(`COALESCE(p.quality_score, -1) >= $${i++}`); values.push(Number(scoreMin)); }
    if (scoreMax !== "") { where.push(`COALESCE(p.quality_score, 999) <= $${i++}`); values.push(Number(scoreMax)); }
    if (wordsMin !== "") { where.push(`COALESCE(p.word_count, 0) >= $${i++}`); values.push(Number(wordsMin)); }
    if (wordsMax !== "") { where.push(`COALESCE(p.word_count, 999999) <= $${i++}`); values.push(Number(wordsMax)); }
    if (service) { where.push(`(lower(COALESCE(s.name,'')) LIKE $${i} OR lower(COALESCE(s.slug,'')) LIKE $${i} OR lower(p.slug) LIKE $${i})`); values.push(`%${service}%`); i++; }
    if (location) { where.push(`(lower(COALESCE(l.name,'')) LIKE $${i} OR lower(COALESCE(l.state_code,'')) LIKE $${i} OR lower(COALESCE(l.state_name,'')) LIKE $${i} OR lower(p.slug) LIKE $${i})`); values.push(`%${location}%`); i++; }
    if (eeat === "missing") where.push("(p.trust_score IS NULL OR p.evidence_score IS NULL OR p.quality_score IS NULL)");
    if (eeat === "weak") where.push("(COALESCE(p.trust_score,0) < 50 OR COALESCE(p.evidence_score,0) < 50 OR COALESCE(p.quality_score,0) < 70)");
    if (eeat === "strong") where.push("(COALESCE(p.trust_score,0) >= 70 AND COALESCE(p.evidence_score,0) >= 70 AND COALESCE(p.quality_score,0) >= 80)");
    if (indexed === "submitted") where.push("p.gsc_submitted_at IS NOT NULL");
    if (indexed === "not_submitted") where.push("p.gsc_submitted_at IS NULL");

    const whereSql = where.join(" AND ");
    const fromSql = `FROM pages p
      LEFT JOIN services s ON p.service_id::text = s.id::text
      LEFT JOIN locations l ON p.location_id::text = l.id::text
      LEFT JOIN blueprints b ON p.blueprint_id::text = b.id::text
      WHERE ${whereSql}`;

    const totalResult = await pool.query(`SELECT COUNT(*)::int AS total ${fromSql}`, values);
    const rowsResult = await pool.query(
      `SELECT p.*, s.name AS service_name, l.name AS location_name, l.state_code AS location_state, b.name AS blueprint_name
       ${fromSql}
       ORDER BY ${SORTS[sort]}
       LIMIT $${i++} OFFSET $${i++}`,
      [...values, limit, offset]
    );

    const facetsResult = await pool.query(
      `SELECT
         COUNT(*)::int AS all_count,
         COUNT(*) FILTER (WHERE p.status='published')::int AS published_count,
         COUNT(*) FILTER (WHERE p.status='review')::int AS review_count,
         COUNT(*) FILTER (WHERE p.status='draft' OR p.is_draft=true)::int AS draft_count,
         COUNT(*) FILTER (WHERE p.tier=1)::int AS tier1_count,
         COUNT(*) FILTER (WHERE p.tier=2)::int AS tier2_count,
         COUNT(*) FILTER (WHERE p.tier=3)::int AS tier3_count,
         COUNT(*) FILTER (WHERE p.trust_score IS NULL OR p.evidence_score IS NULL OR p.quality_score IS NULL)::int AS missing_eeat_count,
         COUNT(*) FILTER (WHERE COALESCE(p.word_count,0) < 700)::int AS thin_count
       FROM pages p WHERE p.website_id::text = $1::text`,
      [websiteId]
    );

    const pageTypesResult = await pool.query(
      `SELECT DISTINCT p.page_type
       FROM pages p
       WHERE p.website_id::text = $1::text
         AND p.page_type IS NOT NULL
         AND p.page_type <> ''
       ORDER BY p.page_type ASC`,
      [websiteId]
    );

    return res.json({
      pages: rowsResult.rows.map(rowToPage),
      total: totalResult.rows[0]?.total || 0,
      page,
      limit,
      totalPages: Math.ceil((totalResult.rows[0]?.total || 0) / limit),
      facets: facetsResult.rows[0] || {},
      pageTypeOptions: pageTypesResult.rows.map((r: any) => r.page_type).filter(Boolean),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
