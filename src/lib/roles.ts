import type { Prisma } from "@prisma/client";

/**
 * Capability grants a role can hold. Coarse, matching the app's two-tier model:
 * - TEAM_MANAGE: manager-level (projects, leave review, edit any report/task,
 *   team-wide visibility).
 * - ADMIN_FULL: admin-level (users, roles, settings, destructive actions).
 * ADMIN_FULL implies TEAM_MANAGE (see lib/authz).
 */
export const PERMISSIONS = {
  TEAM_MANAGE: "TEAM_MANAGE",
  ADMIN_FULL: "ADMIN_FULL",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Default system roles seeded into the Role table (with their capabilities). */
export const DEFAULT_ROLES = [
  { code: "ADMIN", name: "ผู้ดูแลระบบ", description: "สิทธิ์เต็มทั้งระบบ", permissions: ["ADMIN_FULL", "TEAM_MANAGE"] },
  { code: "MANAGER", name: "หัวหน้าทีม", description: "จัดการทีมและอนุมัติ", permissions: ["TEAM_MANAGE"] },
  { code: "DEVELOPER", name: "นักพัฒนา", description: "", permissions: [] },
  { code: "QA", name: "QA", description: "", permissions: [] },
  { code: "DESIGNER", name: "Designer", description: "", permissions: [] },
] as const;

/** Fields returned for an embedded/related role object. */
export const roleSelect = {
  id: true,
  name: true,
  code: true,
  isSystem: true,
  isActive: true,
  permissions: true,
} satisfies Prisma.RoleSelect;
