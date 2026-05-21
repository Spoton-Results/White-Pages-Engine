import { Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import * as storage from "./storage";
import { pool } from "./db";

declare module "express-session" {
  interface SessionData {
    userId: string;
    isSuperAdmin: boolean;
    accountId: string | null;
    role: string;
  }
}

const PgSession = connectPg(session);

export function sessionMiddleware() {
  // In production behind a reverse proxy (Railway, Render, Replit) the
  // cookie MUST be sameSite:"none" + secure:true so the browser sends it
  // on cross-origin API calls, AND the proxy must forward the real protocol
  // via X-Forwarded-Proto.  We keep sameSite:"lax" for local dev.
  //
  // admin.spotonnexus.com is same-origin (frontend + API on same domain),
  // so sameSite:"lax" is correct in both dev and prod.
  // If you ever split the frontend to a separate origin, change to "none"
  // and verify secure:true is also set (browsers reject none + !secure).
  const isProd = process.env.NODE_ENV === "production";

  return session({
    store: new PgSession({
      conString: process.env.DATABASE_URL,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "nexus-platform-secret-2025",
    resave: false,
    saveUninitialized: false,
    cookie: {
      // secure:true requires trust proxy:1 in index.ts (already set)
      // so Express honours X-Forwarded-Proto from Railway's load balancer.
      secure: isProd,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}

function hasSession(req: Request): boolean {
  return !!(req && (req as any).session);
}

function isApiRequest(req: Request): boolean {
  const url = String(req.originalUrl || req.url || "");
  return url.startsWith("/api") || url.startsWith("/api/");
}

function passFrontendRoute(req: Request, next: NextFunction): boolean {
  if (!isApiRequest(req)) {
    next();
    return true;
  }
  return false;
}

async function resolveIsSuperAdmin(userId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT is_super_admin FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return result.rows[0]?.is_super_admin === true;
  } catch {
    return false;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (passFrontendRoute(req, next)) return;

  if (!hasSession(req)) {
    return res.status(500).json({
      message: "Session middleware not initialized",
      code: "SESSION_MISSING",
    });
  }

  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}

export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (passFrontendRoute(req, next)) return;

  if (!hasSession(req)) {
    return res.status(500).json({
      message: "Session middleware not initialized",
      code: "SESSION_MISSING",
    });
  }

  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.session.isSuperAdmin === true) {
    return next();
  }

  const isAdmin = await resolveIsSuperAdmin(req.session.userId);
  if (isAdmin) {
    req.session.isSuperAdmin = true;
    return next();
  }

  return res.status(403).json({ message: "Forbidden: Super Admin only" });
}

export async function requireAccountAccess(req: Request, res: Response, next: NextFunction) {
  if (passFrontendRoute(req, next)) return;

  if (!hasSession(req)) {
    return res.status(500).json({
      message: "Session middleware not initialized",
      code: "SESSION_MISSING",
    });
  }

  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.session.isSuperAdmin) {
    return next();
  }

  const accountId = req.params.accountId || req.body?.accountId;

  if (accountId && req.session.accountId !== accountId) {
    return res.status(403).json({ message: "Forbidden: No access to this account" });
  }

  next();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function envAdminMatches(email: string, password: string): boolean {
  const adminEmail = String(process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || "");
  return !!adminEmail && !!adminPassword && email === adminEmail && password === adminPassword;
}

async function upsertAdminFromEnv(email: string, password: string) {
  if (!envAdminMatches(email, password)) return null;

  const nextHash = await hashPassword(password);
  const username = email.split("@")[0] || "admin";

  const result = await pool.query(
    `INSERT INTO users (id, username, email, password, role, is_super_admin, account_id, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'admin', true, NULL, NOW())
     ON CONFLICT (email)
     DO UPDATE SET
       password = EXCLUDED.password,
       role = 'admin',
       is_super_admin = true,
       account_id = NULL
     RETURNING
       id,
       account_id AS "accountId",
       username,
       email,
       password,
       role,
       is_super_admin AS "isSuperAdmin",
       created_at AS "createdAt"`,
    [username, email, nextHash],
  );

  console.warn(`[auth] Upserted super admin from ADMIN_EMAIL/ADMIN_PASSWORD for ${email}`);
  return result.rows[0];
}

export async function loginUser(req: Request, email: string, password: string) {
  if (!hasSession(req)) {
    throw new Error("Session middleware not initialized");
  }

  let user = await storage.getUserByEmail(email);
  let valid = user ? await verifyPassword(password, user.password) : false;

  if (!valid) {
    const repairedUser = await upsertAdminFromEnv(email, password);
    if (!repairedUser) return null;
    user = repairedUser;
    valid = true;
  }

  if (!user || !valid) return null;

  const isSuperAdmin = await resolveIsSuperAdmin(user.id);

  req.session.userId = user.id;
  req.session.isSuperAdmin = isSuperAdmin;
  req.session.accountId = user.accountId ?? null;
  req.session.role = user.role ?? "user";

  // Force session save before responding so the Set-Cookie header is
  // guaranteed to be written even if the response flushes very fast.
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve()))
  );

  console.log(`[auth] loginUser: userId=${user.id} isSuperAdmin=${isSuperAdmin} role=${user.role}`);

  return { ...user, isSuperAdmin };
}
