/**
 * action-review-decision.ts
 * Graduated from action-review-decision-hotfix.ts — no logic changes.
 *
 * Routes:
 *   POST /api/action-review/:jobId/decision
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";

const router = Router();
router.use(requireAuth);

async function assertWebsiteAccess(req: Request, res: Response, websiteId: string) {
  const result = await pool.query(`SELECT id, account_id FROM websites WHERE id::text = $1::text LIMIT 1`, [websiteId]);
  const website = result.rows[0];
  if (!website) { res.status(404).json({ message: "Website not found" }); return null; }
  if (!req.session.isSuperAdmin && String(req.session.accountId) !== String(website.account_id)) {
    res.status(403).json({ message: "Forbidden: No access to this website" });
    return null;
  }
  return website;
}

function statusForDecision(decision: string) {
  if (decision === "approved") return "completed";
  if (decision === "rejected") return "failed";
  return "pending";
}

function shouldSetCompletedAt(decision: string) {
  return decision === "approved" || decision === "rejected";
}

router.post("/api/action-review/:jobId/decision", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const decision = String(req.body?.decision || "");
    if (!["approved", "rejected", "needs_changes"].includes(decision)) return res.status(400).json({ message: "Invalid decision" });

    const job = (await pool.query(`SELECT id, website_id, settings, error_log FROM generation_jobs WHERE id::text = $1::text LIMIT 1`, [req.params.jobId])).rows[0];
    if (!job) return res.status(404).json({ message: "Review job not found" });
    const website = await assertWebsiteAccess(req, res, job.website_id);
    if (!website) return;

    const decidedAt = new Date().toISOString();
    const nextStatus = statusForDecision(decision);
    const completeNow = shouldSetCompletedAt(decision);
    const notes = Array.isArray(job.error_log) ? job.error_log : [];
    notes.push({ decision, note: req.body?.note || null, decidedAt, decidedBy: req.session.userId || null });

    const currentSettings = job.settings && typeof job.settings === "object" ? job.settings : {};
    const nextSettings = { ...currentSettings, reviewDecision: decision, reviewedAt: decidedAt, reviewedBy: req.session.userId || null };

    await pool.query(
      `UPDATE generation_jobs
       SET status = $4::job_status,
           settings = $2::jsonb,
           error_log = $3::jsonb,
           completed_at = CASE WHEN $5::boolean THEN NOW() ELSE completed_at END
       WHERE id::text = $1::text`,
      [req.params.jobId, JSON.stringify(nextSettings), JSON.stringify(notes), nextStatus, completeNow],
    );

    res.json({ ok: true, jobId: req.params.jobId, decision, status: nextStatus, reviewedAt: decidedAt });
  } catch (err) {
    next(err);
  }
});

export default router;
