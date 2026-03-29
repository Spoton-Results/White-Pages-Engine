import { hashPassword } from "./auth";
import * as storage from "./storage";

export async function seedDatabase() {
  console.log("Seeding database...");

  // Check if admin user already exists
  const existing = await storage.getUserByEmail("admin@nexus.io");
  if (existing) {
    console.log("Database already seeded, skipping.");
    return;
  }

  // ── Super Admin User ──────────────────────────────────────────────────────
  const superAdmin = await storage.createUser({
    accountId: null,
    username: "admin",
    email: "admin@nexus.io",
    password: await hashPassword("admin123"),
    role: "super_admin",
    isSuperAdmin: true,
  });
  console.log("Created super admin:", superAdmin.email);
}
