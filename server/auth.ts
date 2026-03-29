import { Request, Response, NextFunction } from "express";
import session from "express-session";
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

export function sessionMiddleware() {
  return session({
    secret: process.env.SESSION_SECRET || "nexus-platform-secret-2025",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || !req.session.isSuperAdmin) {
    return res.status(403).json({ message: "Forbidden: Super Admin only" });
  }
  next();
}

export async function requireAccountAccess(req: Request, res: Response, next: NextFunction) {
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

export async function loginUser(req: Request, email: string, password: string) {
  const user = await storage.getUserByEmail(email);
  if (!user) return null;
  const valid = await verifyPassword(password, user.password);
  if (!valid) return null;
  req.session.userId = user.id;
  req.session.isSuperAdmin = user.isSuperAdmin;
  req.session.accountId = user.accountId;
  req.session.role = user.role;
  return user;
}
