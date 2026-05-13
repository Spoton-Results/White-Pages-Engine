import { Router, type Request, type Response } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();

function ip(req: Request) {
  return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

router.post("/api/public-events/click", async (req: Request, res: Response) => {
  try {
    const { websiteId, pageId, pageSlug, eventType, targetUrl, label } = req.body || {};
    if (!websiteId || !eventType) return res.status(400).json({ error: "websiteId and eventType are required" });

    await pool.query(
      `CREATE TABLE IF NOT EXISTS public_page_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        website_id TEXT NOT NULL,
        page_id TEXT,
        page_slug TEXT,
        event_type TEXT NOT NULL,
        target_url TEXT,
        label TEXT,
        user_agent TEXT,
        ip_address TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )`
    );
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_public_page_events_site_time ON public_page_events(website_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_public_page_events_page ON public_page_events(page_id)`);

    await pool.query(
      `INSERT INTO public_page_events (website_id, page_id, page_slug, event_type, target_url, label, user_agent, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [websiteId, pageId || null, pageSlug || null, eventType, targetUrl || null, label || null, String(req.headers["user-agent"] || ""), ip(req)]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("public click event failed", error);
    return res.status(500).json({ error: "Failed to record event" });
  }
});

router.get("/api/websites/:websiteId/page-intelligence/graph", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    const result = await pool.query(
      `WITH page_base AS (
         SELECT id, slug, title, page_type, tier, quality_score, status
         FROM pages
         WHERE website_id::text = $1::text AND status = 'published' AND COALESCE(noindex,false)=false
       ), link_counts AS (
         SELECT
           p.id,
           COUNT(DISTINCT il_in.id)::int AS inbound_links,
           COUNT(DISTINCT il_out.id)::int AS outbound_links
         FROM page_base p
         LEFT JOIN internal_links il_in ON il_in.to_page_id::text = p.id::text
         LEFT JOIN internal_links il_out ON il_out.from_page_id::text = p.id::text
         GROUP BY p.id
       )
       SELECT pb.*, COALESCE(lc.inbound_links,0) AS inbound_links, COALESCE(lc.outbound_links,0) AS outbound_links,
         LEAST(100, GREATEST(0,
           COALESCE(pb.quality_score,50)
           + CASE WHEN COALESCE(lc.inbound_links,0) >= 3 THEN 15 WHEN COALESCE(lc.inbound_links,0) = 0 THEN -25 ELSE 5 END
           + CASE WHEN COALESCE(lc.outbound_links,0) >= 3 THEN 10 WHEN COALESCE(lc.outbound_links,0) = 0 THEN -10 ELSE 3 END
           + CASE WHEN pb.tier = 1 THEN 8 WHEN pb.tier = 2 THEN 3 ELSE 0 END
         ))::int AS graph_score
       FROM page_base pb
       LEFT JOIN link_counts lc ON lc.id = pb.id
       ORDER BY graph_score ASC, inbound_links ASC, quality_score DESC NULLS LAST
       LIMIT 500`,
      [websiteId]
    );
    return res.json({ pages: result.rows });
  } catch (error) {
    console.error("graph intelligence failed", error);
    return res.status(500).json({ error: "Failed to load graph intelligence" });
  }
});

router.get("/api/websites/:websiteId/page-intelligence/orphans", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    const result = await pool.query(
      `SELECT p.id, p.slug, p.title, p.page_type, p.tier, p.quality_score, p.published_at
       FROM pages p
       LEFT JOIN internal_links il ON il.to_page_id::text = p.id::text
       WHERE p.website_id::text = $1::text
         AND p.status = 'published'
         AND COALESCE(p.noindex,false)=false
       GROUP BY p.id
       HAVING COUNT(il.id) = 0
       ORDER BY p.tier ASC NULLS LAST, p.quality_score DESC NULLS LAST, p.published_at DESC NULLS LAST
       LIMIT 500`,
      [websiteId]
    );
    return res.json({ orphanCount: result.rowCount, pages: result.rows });
  } catch (error) {
    console.error("orphan report failed", error);
    return res.status(500).json({ error: "Failed to load orphan pages" });
  }
});

router.post("/api/websites/:websiteId/page-intelligence/repair-orphans", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    await pool.query(`CREATE TABLE IF NOT EXISTS internal_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), website_id TEXT NOT NULL, from_page_id TEXT NOT NULL, to_page_id TEXT NOT NULL,
      anchor_text TEXT NOT NULL, link_type TEXT NOT NULL DEFAULT 'contextual', created_at TIMESTAMP DEFAULT NOW()
    )`);

    const result = await pool.query(
      `WITH orphans AS (
         SELECT p.*
         FROM pages p
         LEFT JOIN internal_links il ON il.to_page_id::text = p.id::text
         WHERE p.website_id::text = $1::text AND p.status='published' AND COALESCE(p.noindex,false)=false
         GROUP BY p.id
         HAVING COUNT(il.id)=0
         LIMIT 100
       ), sources AS (
         SELECT o.id AS orphan_id, s.id AS source_id, o.title AS anchor_text,
           ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY
             CASE WHEN s.service_id::text = o.service_id::text THEN 0 ELSE 1 END,
             CASE WHEN s.location_id::text = o.location_id::text THEN 0 ELSE 1 END,
             s.quality_score DESC NULLS LAST,
             s.published_at DESC NULLS LAST
           ) AS rn
         FROM orphans o
         JOIN pages s ON s.website_id::text = o.website_id::text AND s.id::text <> o.id::text
         WHERE s.status='published' AND COALESCE(s.noindex,false)=false
       )
       INSERT INTO internal_links (website_id, from_page_id, to_page_id, anchor_text, link_type)
       SELECT $1, source_id, orphan_id, anchor_text, 'orphan_repair'
       FROM sources
       WHERE rn <= 3
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [websiteId]
    );
    return res.json({ success: true, linksCreated: result.rowCount || 0 });
  } catch (error) {
    console.error("orphan repair failed", error);
    return res.status(500).json({ error: "Failed to repair orphan pages" });
  }
});

router.get("/api/websites/:websiteId/page-intelligence/crawl-depth", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    const result = await pool.query(
      `WITH RECURSIVE seeds AS (
         SELECT id, slug, title, 0 AS depth
         FROM pages
         WHERE website_id::text=$1::text AND status='published' AND COALESCE(noindex,false)=false
           AND (page_type IN ('state_hub','city_hub') OR tier = 1)
         LIMIT 100
       ), walk AS (
         SELECT * FROM seeds
         UNION
         SELECT p.id, p.slug, p.title, w.depth + 1
         FROM walk w
         JOIN internal_links il ON il.from_page_id::text = w.id::text
         JOIN pages p ON p.id::text = il.to_page_id::text
         WHERE p.website_id::text=$1::text AND p.status='published' AND COALESCE(p.noindex,false)=false AND w.depth < 5
       )
       SELECT id, slug, title, MIN(depth)::int AS depth
       FROM walk
       GROUP BY id, slug, title
       ORDER BY depth ASC, title ASC
       LIMIT 1000`,
      [websiteId]
    );
    const buckets = result.rows.reduce((acc: any, row: any) => { acc[row.depth] = (acc[row.depth] || 0) + 1; return acc; }, {});
    return res.json({ buckets, pages: result.rows });
  } catch (error) {
    console.error("crawl depth failed", error);
    return res.status(500).json({ error: "Failed to load crawl depth" });
  }
});

router.get("/api/websites/:websiteId/conversion-analytics", requireAuth, async (req: Request, res: Response) => {
  try {
    const { websiteId } = req.params;
    await pool.query(`CREATE TABLE IF NOT EXISTS public_page_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), website_id TEXT NOT NULL, page_id TEXT, page_slug TEXT, event_type TEXT NOT NULL,
      target_url TEXT, label TEXT, user_agent TEXT, ip_address TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);
    const events = await pool.query(
      `SELECT event_type, COUNT(*)::int AS count
       FROM public_page_events
       WHERE website_id::text = $1::text AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY event_type
       ORDER BY count DESC`,
      [websiteId]
    );
    const forms = await pool.query(
      `SELECT COUNT(*)::int AS total_forms
       FROM tracked_leads
       WHERE website_id::text = $1::text AND form_timestamp >= NOW() - INTERVAL '30 days'`,
      [websiteId]
    );
    const topPages = await pool.query(
      `SELECT COALESCE(page_slug, page_id, 'unknown') AS page, COUNT(*)::int AS events
       FROM public_page_events
       WHERE website_id::text = $1::text AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY COALESCE(page_slug, page_id, 'unknown')
       ORDER BY events DESC
       LIMIT 25`,
      [websiteId]
    );
    return res.json({ events: events.rows, totalForms: forms.rows[0]?.total_forms || 0, topPages: topPages.rows });
  } catch (error) {
    console.error("conversion analytics failed", error);
    return res.status(500).json({ error: "Failed to load conversion analytics" });
  }
});

export default router;
