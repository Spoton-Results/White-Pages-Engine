import { Router } from "express";
import { requireAuth } from "../auth";
import { createIntentBuildJob, getLatestIntentBuildJob } from "../services/intent-build-job";

const router = Router();

// Mounted at /api/intent-build in index.ts
// Routes are relative — do NOT include /api/intent-build/ prefix here.

// POST /api/intent-build/websites/:websiteId/run
router.post("/websites/:websiteId/run", requireAuth, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const result = await createIntentBuildJob(websiteId);
    return res.status(result.alreadyRunning ? 200 : 202).json(result);
  } catch (error: any) {
    console.error("[intent-build] run failed:", error);
    return res.status(500).json({ error: "Failed to start intent build", message: error?.message });
  }
});

// GET /api/intent-build/websites/:websiteId/status
router.get("/websites/:websiteId/status", requireAuth, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const job = await getLatestIntentBuildJob(websiteId);
    return res.json({ job });
  } catch (error: any) {
    console.error("[intent-build] status failed:", error);
    return res.status(500).json({ error: "Failed to fetch intent build status", message: error?.message });
  }
});

// GET /api/intent-build/websites/:websiteId/report
router.get("/websites/:websiteId/report", requireAuth, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const job = await getLatestIntentBuildJob(websiteId);
    return res.json({ job, report: job?.result_json ?? job?.resultJson ?? null });
  } catch (error: any) {
    console.error("[intent-build] report failed:", error);
    return res.status(500).json({ error: "Failed to fetch intent build report", message: error?.message });
  }
});

export default router;
