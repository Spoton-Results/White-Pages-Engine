import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";

const router = Router();

router.delete("/api/websites/:websiteId/hub-pages/:hubId", requireAuth, async (req: Request, res: Response) => {
  try {
    const website = await pool.query<{ account_id: string }>(
      "SELECT account_id FROM websites WHERE id::text = $1::text LIMIT 1",
      [req.params.websiteId],
    );
    if (website.rows.length === 0) {
      return res.status(404).json({ message: "Website not found" });
    }

    const isSuperAdmin = req.session.isSuperAdmin === true;
    if (!isSuperAdmin && req.session.accountId !== website.rows[0].account_id) {
      return res.status(403).json({ message: "Forbidden: No access to this website" });
    }

    const deleted = await pool.query<{ id: string }>(
      `DELETE FROM hub_pages AS h
       USING websites AS w
       WHERE h.website_id = w.id
         AND h.id::text = $1::text
         AND w.id::text = $2::text
         AND ($3::boolean OR w.account_id::text = $4::text)
       RETURNING h.id`,
      [req.params.hubId, req.params.websiteId, isSuperAdmin, req.session.accountId ?? null],
    );
    if (deleted.rows.length === 0) {
      return res.status(404).json({ message: "Hub page not found in this website" });
    }

    return res.json({ deleted: true, id: deleted.rows[0].id });
  } catch (error) {
    console.error("[hub-page-delete] Failed:", error);
    return res.status(500).json({ message: "Failed to delete hub page. Check the hub list before retrying." });
  }
});

export default router;
