import { Router } from "express";
import { getOrchestrationHealthSnapshot } from "../services/orchestration-observability";
import { runContinuousOrchestration } from "../services/continuous-orchestration-engine";
import { runAutonomousSeoStrategy } from "../services/autonomous-seo-strategy";
import { runAutonomousExecutionEngine } from "../services/autonomous-execution-engine";
import { runPerformanceFeedbackLoop } from "../services/performance-feedback-loop";
import { auditPageCannibalizationRisk, auditVariationSemanticRisk } from "../services/semantic-content-intelligence";

const router = Router();

router.get("/api/autonomous/health", async (_req, res, next) => {
  try {
    const snapshot = await getOrchestrationHealthSnapshot();
    res.json(snapshot);
  } catch (err) {
    next(err);
  }
});

router.post("/api/autonomous/orchestrate", async (req, res, next) => {
  try {
    const result = await runContinuousOrchestration({
      websiteId: req.body?.websiteId,
      cycles: Number(req.body?.cycles ?? 1),
      dryRun: req.body?.dryRun !== false,
      allowExecution: Boolean(req.body?.allowExecution),
      allowLinkApply: Boolean(req.body?.allowLinkApply),
      allowPrune: Boolean(req.body?.allowPrune),
      generationLimit: Number(req.body?.generationLimit ?? 5),
      reviewLimit: Number(req.body?.reviewLimit ?? 50),
      auditLimit: Number(req.body?.auditLimit ?? 250),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/api/autonomous/strategy", async (req, res, next) => {
  try {
    const result = await runAutonomousSeoStrategy({
      websiteId: req.body?.websiteId,
      limit: Number(req.body?.limit ?? 250),
      dryRun: req.body?.dryRun !== false,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/api/autonomous/execute", async (req, res, next) => {
  try {
    const result = await runAutonomousExecutionEngine({
      websiteId: req.body?.websiteId,
      limit: Number(req.body?.limit ?? 250),
      dryRun: req.body?.dryRun !== false,
      allowLinkApply: Boolean(req.body?.allowLinkApply),
      allowPrune: Boolean(req.body?.allowPrune),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/api/autonomous/performance", async (req, res, next) => {
  try {
    const result = await runPerformanceFeedbackLoop({
      websiteId: req.body?.websiteId,
      limit: Number(req.body?.limit ?? 250),
      dryRun: req.body?.dryRun !== false,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/api/autonomous/semantic", async (req, res, next) => {
  try {
    const [variationRisk, pageRisk] = await Promise.all([
      auditVariationSemanticRisk({
        websiteId: req.body?.websiteId,
        limit: Number(req.body?.limit ?? 100),
        dryRun: req.body?.dryRun !== false,
      }),
      auditPageCannibalizationRisk({
        websiteId: req.body?.websiteId,
        limit: Number(req.body?.limit ?? 100),
        dryRun: req.body?.dryRun !== false,
      }),
    ]);

    res.json({ variationRisk, pageRisk });
  } catch (err) {
    next(err);
  }
});

export default router;
