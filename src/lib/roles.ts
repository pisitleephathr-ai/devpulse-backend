import type { Prisma } from "@prisma/client";

/** Default system roles seeded into the Role table. */
export const DEFAULT_ROLES = [
  { code: "ADMIN", name: "ผู้ดูแลระบบ", description: "สิทธิ์เต็มทั้งระบบ" },
  { code: "MANAGER", name: "หัวหน้าทีม", description: "จัดการทีมและอนุมัติ" },
  { code: "DEVELOPER", name: "นักพัฒนา", description: "" },
  { code: "QA", name: "QA", description: "" },
  { code: "DESIGNER", name: "Designer", description: "" },
] as const;

/** Fields returned for an embedded/related role object. */
export const roleSelect = {
  id: true,
  name: true,
  code: true,
  isSystem: true,
  isActive: true,
} satisfies Prisma.RoleSelect;
