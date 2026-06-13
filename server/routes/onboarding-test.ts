import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { processOnboardingSubmission, calculateReadinessScore, runOnboardingGeneration } from "../services/onboarding";
import { runLaunchGovernors } from "../services/launch-governors";
import { detectDuplicateIntent, getWarmupPageLimit } from "../services/safety-rails";
import { calculateLaunchHealthScore } from "../services/launch-health";

const router = Router();

function token() {
  return `test_${crypto.randomBytes(24).toString("hex")}`;
}

async function getSubmission(id: string) {
  const { rows } = await pool.query(`SELECT * FROM onboarding_submissions WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
}

// ✅ CHANGED: restore Onboarding Test Tool list route.
// 🔒 UNTOUCHED: live onboarding and Stripe routes.
router.get("/api/admin/test/submissions", requireAuth, async (_req: Request, res: Response) => {
  const { rows } = await pool.query(`
    SELECT *
    FROM onboarding_submissions
    WHERE stripe_session_id LIKE 'cs_test_manual_%'
       OR token LIKE 'test_%'
    ORDER BY created_at DESC
    LIMIT 100
  `);
  res.json(rows);
});

// ✅ CHANGED: restore detail route.
router.get("/api/admin/test/submission/:id", requireAuth, async (req: Request, res: Response) => {
  const submission = await getSubmission(req.params.id);
  if (!submission) return res.status(404).json({ message: "Test submission not found" });

  let account = null;
  let website = null;

  if (submission.account_id) {
    const r = await pool.query(`SELECT * FROM accounts WHERE id = $1 LIMIT 1`, [submission.account_id]);
    account = r.rows[0] || null;
  }

  if (submission.website_id) {
    const r = await pool.query(`SELECT * FROM websites WHERE id = $1 LIMIT 1`, [submission.website_id]);
    website = r.rows[0] || null;
  }

  res.json({ submission, account, website });
});

// ✅ CHANGED: restore pages route.
router.get("/api/admin/test/submission/:id/pages", requireAuth, async (req: Request, res: Response) => {
  const submission = await getSubmission(req.params.id);
  if (!submission?.website_id) return res.json({ pages: [], count: 0 });

  const { rows } = await pool.query(`
    SELECT id, title, slug, status, tier, quality_score, created_at, updated_at
    FROM pages
    WHERE website_id = $1
    ORDER BY created_at DESC
    LIMIT 100
  `, [submission.website_id]);

  res.json({ pages: rows, count: rows.length });
});

// ✅ CHANGED: restore manual test submission creation.
router.post("/api/admin/test/create-submission", requireAuth, async (req: Request, res: Response) => {
  const t = token();
  const stripeSessionId = `cs_test_manual_${Date.now()}`;

  const { rows } = await pool.query(`
    INSERT INTO onboarding_submissions
      (token, stripe_session_id, plan_type, status, form_data, onboarding_notes, submitted_at, created_at)
    VALUES
      ($1, $2, $3, 'submitted', $4::jsonb, 'Manual onboarding test submission', NOW(), NOW())
    RETURNING *
  `, [
    t,
    stripeSessionId,
    req.body?.planType || "local_launch",
    JSON.stringify(req.body || {}),
  ]);

  res.json({ submission: rows[0] });
});

// ✅ CHANGED: restore phase runner wrapper around existing services.
router.post("/api/admin/test/run-phase/:phase", requireAuth, async (req: Request, res: Response) => {
  const phase = Number(req.params.phase);
  const submissionId = String(req.body?.submissionId || "");
  const submission = await getSubmission(submissionId);

  if (!submission) return res.status(404).json({ message: "Test submission not found" });

  if (phase === 4) {
    const result = await processOnboardingSubmission(submissionId);
    return res.json(result);
  }

  if (phase === 5) {
    const result = await calculateReadinessScore(submissionId);
    return res.json(result);
  }

  if (phase === 6) {
    const result = await runOnboardingGeneration(submissionId, { overwrite: !!req.body?.overwrite });
    return res.json(result);
  }

  if (phase === 7) {
    if (!submission.website_id) return res.status(400).json({ message: "Submission has no website_id" });
    const result = await runLaunchGovernors(submission.website_id);
    return res.json(result);
  }

  if (phase === 8) {
    if (!submission.website_id) return res.status(400).json({ message: "Submission has no website_id" });
    const duplicates = await detectDuplicateIntent(submission.website_id);
    const warmup = await getWarmupPageLimit(submission.website_id);
    return res.json({ duplicates, warmup });
  }

  if (phase === 9) {
    if (!submission.website_id) return res.status(400).json({ message: "Submission has no website_id" });
    const result = await calculateLaunchHealthScore(submission.website_id);
    return res.json(result);
  }

  return res.status(400).json({ message: `Unsupported phase ${phase}` });
});

// ✅ CHANGED: restore delete route for test submissions.
router.delete("/api/admin/test/submission/:id", requireAuth, async (req: Request, res: Response) => {
  await pool.query(`DELETE FROM onboarding_submissions WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

export default router;
