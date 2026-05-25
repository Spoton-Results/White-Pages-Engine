import { Router } from "express";

// Emergency rollback shim.
// This router is intentionally empty so the mounted override path does not
// intercept Variation Bank, login, or app boot requests. Core API owns these
// routes again until the bank writer is fixed safely.
const router = Router();

export default router;
