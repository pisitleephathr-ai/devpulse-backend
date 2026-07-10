/**
 * One-off: seed the 5 default roles and backfill User.roleId from the legacy
 * User.role enum. Idempotent. Run once against production after the
 * `dynamic_roles` migration:
 *
 *   DATABASE_URL=... npm run seed:roles
 *
 * Boss (boss@devpulse.io) is set to ADMIN so the real team has an admin who can
 * manage roles/users/settings. Existing users keep their mapped role.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_ROLES } from "../src/lib/roles";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding roles + backfilling User.roleId…");

  // 1) Upsert the default system roles.
  const roleByCode: Record<string, string> = {};
  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, isSystem: true },
      create: { code: r.code, name: r.name, description: r.description, isSystem: true, isActive: true },
    });
    roleByCode[r.code] = role.id;
  }
  console.log(`   roles ready: ${Object.keys(roleByCode).join(", ")}`);

  // 2) Backfill each user's roleId from the legacy enum (default DEVELOPER).
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, roleId: true } });
  let backfilled = 0;
  for (const u of users) {
    const code = u.email === "boss@devpulse.io" ? "ADMIN" : (u.role ?? "DEVELOPER");
    const roleId = roleByCode[code] ?? roleByCode["DEVELOPER"];
    if (u.roleId === roleId) continue;
    await prisma.user.update({
      where: { id: u.id },
      // keep legacy enum in sync when the code is a valid enum value
      data: {
        roleId,
        role: ["MANAGER", "ADMIN", "DEVELOPER", "QA"].includes(code)
          ? (code as "MANAGER" | "ADMIN" | "DEVELOPER" | "QA")
          : undefined,
      },
    });
    backfilled++;
  }

  const summary = await prisma.user.findMany({
    select: { email: true, roleRef: { select: { code: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`   backfilled ${backfilled} users`);
  summary.forEach((u) => console.log(`     ${u.email} → ${u.roleRef?.code ?? "(none)"}`));
  console.log("✅ Roles seeded");
}

main()
  .catch((e) => {
    console.error("❌ seed-roles failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
