import { Router, type Request, type Response } from "express";
import { requireAuth, requireSuperAdmin } from "../auth";
import * as storage from "../storage";
import { insertAgencySchema } from "@shared/schema";

const router = Router();

router.get("/api/agencies", requireAuth, async (_req: Request, res: Response) => {
  const agencies = await storage.getAgencies();

  if (agencies.length > 0) {
    return res.json(agencies);
  }

  // Legacy fallback: older builds treated agencies as accounts. Keep the tab
  // populated instead of showing empty when no rows exist in agencies yet.
  const accounts = await storage.getAccounts();
  return res.json(accounts.map((a: any) => ({
    id: a.agencyId || a.id,
    name: a.agencyId ? `Agency ${a.agencyId}` : a.name,
    contactName: "",
    email: "",
    phone: "",
    monthlyFee: null,
    startDate: "",
    status: a.status || "active",
    createdAt: a.createdAt,
    _legacyAccountFallback: true,
  })));
});

router.get("/api/agencies/:id/accounts", requireAuth, async (req: Request, res: Response) => {
  const accounts = await storage.getAgencyAccounts(req.params.id);

  if (accounts.length > 0) {
    return res.json(accounts);
  }

  // Legacy fallback: if old account records were never assigned an agency_id,
  // return unassigned accounts so the Agency detail drawer still has data.
  const allAccounts = await storage.getAccounts();
  const assignedCount = allAccounts.filter((a: any) => !!a.agencyId).length;
  if (assignedCount === 0) {
    return res.json(allAccounts);
  }

  return res.json([]);
});

router.get("/api/agencies/:id", requireAuth, async (req: Request, res: Response) => {
  const agency = await storage.getAgency(req.params.id);
  if (agency) return res.json(agency);

  // Legacy fallback for account-as-agency IDs.
  const account = await storage.getAccount(req.params.id);
  if (!account) return res.status(404).json({ message: "Agency not found" });
  return res.json({
    id: account.id,
    name: account.name,
    contactName: "",
    email: "",
    phone: "",
    monthlyFee: null,
    startDate: "",
    status: account.status || "active",
    createdAt: account.createdAt,
    _legacyAccountFallback: true,
  });
});

router.post("/api/agencies", requireAuth, async (req: Request, res: Response) => {
  const parsed = insertAgencySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
  const agency = await storage.createAgency(parsed.data);
  return res.status(201).json(agency);
});

router.put("/api/agencies/:id", requireAuth, async (req: Request, res: Response) => {
  const agency = await storage.updateAgency(req.params.id, req.body);
  if (!agency) return res.status(404).json({ message: "Agency not found" });
  return res.json(agency);
});

router.delete("/api/agencies/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  await storage.deleteAgency(req.params.id);
  return res.json({ message: "Agency deleted" });
});

export default router;
