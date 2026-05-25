import { Router } from "express";

// Disabled override router.
// The previous implementation introduced runtime instability during boot.
// Keep the mount intact but expose no routes so requests fall back to core-api.
const router = Router();

export default router;
