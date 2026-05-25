import { Router } from "express";
import { loginUser, hashPassword, verifyPassword } from "../auth";
import * as storage from "../storage";
import { pool } from "../db";

const router = Router();

router.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();
    const secret = String(req.body?.password || "");

    if (!email || !secret) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    console.log(`[auth/login] attempt email=${email} passwordLen=${secret.length}`);

    const user = await loginUser(req, email, secret);
    if (!user) {
      console.warn(`[auth/login] loginUser returned null for email=${email}`);
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Store enough user info in session so /api/auth/me does not need to hit
    // Postgres on every app boot. This prevents the whole UI from failing with
    // {"message":"timeout exceeded when trying to connect"} when DB is slow.
    (req.session as any).userEmail = user.email;
    (req.session as any).username = user.username;

    console.log(`[auth/login] success userId=${user.id} isSuperAdmin=${user.isSuperAdmin}`);

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
    console.error("[auth/login] threw:", err);
    next(err);
  }
});

/**
 * GET /api/auth/debug
 * Returns diagnostic info to help trace login failures.
 * Safe — no passwords or hashes are returned.
 * Remove this endpoint once login is confirmed working.
 */
router.get("/api/auth/debug", async (req, res) => {
  try {
    const adminEmail = String(process.env.ADMIN_EMAIL || "").toLowerCase().trim();
    const adminPasswordRaw = String(process.env.ADMIN_PASSWORD || "");
    const adminPasswordTrimmed = adminPasswordRaw.trim();

    const dbUser = adminEmail ? await storage.getUserByEmail(adminEmail).catch(() => null) : null;
    const sessionTableCheck = await pool
      .query(`SELECT to_regclass('public.session') AS tbl`)
      .catch(() => ({ rows: [{ tbl: "ERROR" }] }));

    res.json({
      env: {
        ADMIN_EMAIL_set: !!adminEmail,
        ADMIN_EMAIL_value: adminEmail || "(not set)",
        ADMIN_PASSWORD_set: !!adminPasswordRaw,
        ADMIN_PASSWORD_length: adminPasswordRaw.length,
        ADMIN_PASSWORD_trimmed_length: adminPasswordTrimmed.length,
        ADMIN_PASSWORD_has_whitespace: adminPasswordRaw !== adminPasswordTrimmed,
        NODE_ENV: process.env.NODE_ENV || "(not set)",
        SESSION_SECRET_set: !!(process.env.SESSION_SECRET),
        DATABASE_URL_set: !!(process.env.DATABASE_URL),
      },
      db: {
        userRowExists: !!dbUser,
        userRole: dbUser?.role ?? null,
        userIsSuperAdmin: dbUser ? (dbUser as any).isSuperAdmin ?? (dbUser as any).is_super_admin ?? null : null,
        sessionTable: sessionTableCheck.rows[0]?.tbl ?? null,
      },
      session: {
        exists: !!req.session,
        userId: req.session?.userId ?? null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

router.get("/api/auth/me", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Fast path: do NOT hit Postgres during app boot. The session is already the
  // source of truth for whether the user is authenticated.
  const sessionUser = {
    id: req.session.userId,
    email: (req.session as any).userEmail ?? null,
    username: (req.session as any).username ?? "admin",
    role: req.session.role ?? "user",
    isSuperAdmin: req.session.isSuperAdmin === true,
    accountId: req.session.accountId ?? null,
  };

  return res.json({ user: sessionUser });
});

router.post("/api/auth/logout", async (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

export default router;
