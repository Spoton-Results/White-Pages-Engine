import { Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import * as storage from "./storage";

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
      secure: process.env.NODE_ENV === "production",
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
  return String(req.originalUrl || req.url || "").startsWith("/api");
}

function passFrontendRoute(req: Request, next: NextFunction): boolean {
  if (!isApiRequest(req)) {
    next();
    return true;
  }
  return false;
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

  if (!req.session.isSuperAdmin) {
    return res.status(403).json({ message: "Forbidden: Super Admin only" });
  }

  next();
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

async function repairAdminPasswordIfEnvMatches(email: string, password: string, user: any): Promise<boolean> {
  const adminEmail = String(process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || "");

  if (!adminEmail || !adminPassword) return false;
  if (email !== adminEmail) return false;
  if (password !== adminPassword) return false;
  if (!user?.isSuperAdmin) return false;

  const nextHash = await hashPassword(adminPassword);
  await storage.updateUser(user.id, { password: nextHash } as any);
  console.warn(`[auth] Repaired super admin password hash from ADMIN_PASSWORD for ${adminEmail}`);
  return true;
}

export async function loginUser(req: Request, email: string, password: string) {
  if (!hasSession(req)) {
    throw new Error("Session middleware not initialized");
  }

  const user = await storage.getUserByEmail(email);
  if (!user) return null;

  const valid = await verifyPassword(password, user.password);
  const repaired = valid ? false : await repairAdminPasswordIfEnvMatches(email, password, user);
  if (!valid && !repaired) return null;

  req.session.userId = user.id;
  req.session.isSuperAdmin = user.isSuperAdmin;
  req.session.accountId = user.accountId;
  req.session.role = user.role;

  return user;
}