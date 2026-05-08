import { Router } from "express";
import { loginUser } from "../auth";
import * as storage from "../storage";

const router = Router();

router.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();
    const secret = String(req.body?.password || "");

    if (!email || !secret) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await loginUser(req, email, secret);
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        accountId: user.accountId,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/api/auth/me", async (req, res, next) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Unauthorized" });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        accountId: user.accountId,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/api/auth/logout", async (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

export default router;
