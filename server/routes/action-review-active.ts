import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

router.get("/api/websites/:websiteId/action-review-active", async (req, res, next) => {
  try {
    const website = (await pool.query("SELECT id, account_id FROM websites WHERE id::text = $1::text LIMIT 1", [req.params.websiteId])).rows[0];
    if (!website) return res.status(404).json({ message: "Website not found" });
    if (!req.session.isSuperAdmin && String(req.session.accountId) !== String(website.account_id)) return res.status(403).json({ message: "Forbidden" });

    const result = await pool.query(
      `SELECT gj.id, gj.name, gj.status, gj.settings, gj.created_at, gj.completed_at, gj.error_log,
              p.slug AS winner_slug, p.title AS winner_title, p.tier AS winner_tier
       FROM generation_jobs gj
       LEFT JOIN pages p ON p.id::text = COALESCE(gj.settings->>'winnerPageId', gj.settings->>'pageId')
       WHERE gj.website_id::text = $1::text
         AND gj.settings->>'type' IN ('intent_consolidation_review', 'intent_merge_review', 'intent_governance_execute')
         AND COALESCE(gj.settings->>'reviewDecision', '') NOT IN ('approved', 'rejected')
         AND gj.status::text NOT IN ('completed', 'failed')
       ORDER BY gj.created_at DESC
       LIMIT 100`,
      [req.params.websiteId]
    );

    res.json(result.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      type: r.settings?.type,
      intentCluster: r.settings?.intentCluster,
      reviewDecision: r.settings?.reviewDecision || null,
      winnerPageId: r.settings?.winnerPageId,
      winnerSlug: r.winner_slug || r.settings?.winnerSlug,
      winnerTitle: r.winner_title,
      winnerTier: r.winner_tier,
      requiresConfirmation: !!r.settings?.requiresConfirmation,
      redirectRequiredBeforePrune: !!r.settings?.redirectRequiredBeforePrune,
      destructiveActionAllowed: !!r.settings?.destructiveActionAllowed,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      notes: r.error_log || []
    })));
  } catch (err) {
    next(err);
  }
});

export default router;
