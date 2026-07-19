import type { Prisma } from "@prisma/client";

/**
 * Capability grants a role can hold. Two coarse tiers plus fine-grained
 * capabilities that they imply:
 * - ADMIN_FULL: everything (users, roles, settings, destructive actions).
 * - TEAM_MANAGE: manager tier (projects, leave review, edit any report/task,
 *   team-wide visibility) — implies the manager-level fine-grained set.
 * A custom role may instead be granted individual fine-grained capabilities.
 * All expansion happens in `expandPermissions` so checks stay consistent.
 */
export const PERMISSIONS = {
  ADMIN_FULL: "ADMIN_FULL",
  TEAM_MANAGE: "TEAM_MANAGE",
  USER_MANAGE: "USER_MANAGE",
  ROLE_MANAGE: "ROLE_MANAGE",
  PROJECT_MANAGE: "PROJECT_MANAGE",
  LEAVE_APPROVE: "LEAVE_APPROVE",
  ACTIVITY_VIEW: "ACTIVITY_VIEW",
  SETTINGS_MANAGE: "SETTINGS_MANAGE",
  TASK_CREATE: "TASK_CREATE",
  TASK_DELETE: "TASK_DELETE",
  TASK_EDIT_ANY: "TASK_EDIT_ANY",
  REPORT_EDIT_ANY: "REPORT_EDIT_ANY",
  /// Upload a task attachment even without being the assignee.
  TASK_ATTACHMENT_UPLOAD: "TASK_ATTACHMENT_UPLOAD",
  /// Delete any task attachment (not just one you uploaded).
  TASK_ATTACHMENT_DELETE: "TASK_ATTACHMENT_DELETE",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Fine-grained capabilities the manager tier (TEAM_MANAGE) implies. */
const TEAM_MANAGE_IMPLIES: Permission[] = [
  PERMISSIONS.PROJECT_MANAGE,
  PERMISSIONS.LEAVE_APPROVE,
  PERMISSIONS.ACTIVITY_VIEW,
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.TASK_CREATE,
  PERMISSIONS.TASK_DELETE,
  PERMISSIONS.TASK_EDIT_ANY,
  PERMISSIONS.REPORT_EDIT_ANY,
  PERMISSIONS.TASK_ATTACHMENT_UPLOAD,
  PERMISSIONS.TASK_ATTACHMENT_DELETE,
];

/**
 * Expand a role's raw permission grants (and optional legacy role code) into the
 * full effective capability set, applying tier implications:
 *  - legacy ADMIN code  → ADMIN_FULL
 *  - legacy MANAGER code → TEAM_MANAGE
 *  - ADMIN_FULL          → every capability
 *  - TEAM_MANAGE         → the manager-level fine-grained set
 * Backward-compatible and additive — no existing role loses access.
 */
export function expandPermissions(
  perms: readonly string[] | null | undefined,
  roleCode?: string | null
): Set<string> {
  const set = new Set<string>(perms ?? []);
  if (roleCode === "ADMIN") set.add(PERMISSIONS.ADMIN_FULL);
  if (roleCode === "MANAGER") set.add(PERMISSIONS.TEAM_MANAGE);
  if (set.has(PERMISSIONS.ADMIN_FULL)) {
    for (const p of ALL_PERMISSIONS) set.add(p);
  }
  if (set.has(PERMISSIONS.TEAM_MANAGE)) {
    for (const p of TEAM_MANAGE_IMPLIES) set.add(p);
  }
  return set;
}

/** Whether a role (by its grants + optional code) is a full admin. */
export function roleIsAdmin(
  perms: readonly string[] | null | undefined,
  roleCode?: string | null
): boolean {
  return expandPermissions(perms, roleCode).has(PERMISSIONS.ADMIN_FULL);
}

/**
 * Default system roles seeded into the Role table (with their capabilities).
 * `assignable` = appears on the task board (assignable + shown in team workload).
 * Admins are system managers, not task workers, so they default off.
 */
export const DEFAULT_ROLES = [
  { code: "ADMIN", name: "ผู้ดูแลระบบ", description: "สิทธิ์เต็มทั้งระบบ", permissions: ["ADMIN_FULL", "TEAM_MANAGE"], assignable: false },
  { code: "MANAGER", name: "หัวหน้าทีม", description: "จัดการทีมและอนุมัติ", permissions: ["TEAM_MANAGE"], assignable: true },
  { code: "DEVELOPER", name: "นักพัฒนา", description: "", permissions: [], assignable: true },
  { code: "QA", name: "QA", description: "", permissions: [], assignable: true },
  { code: "DESIGNER", name: "Designer", description: "", permissions: [], assignable: true },
] as const;

/** Fields returned for an embedded/related role object. */
export const roleSelect = {
  id: true,
  name: true,
  code: true,
  isSystem: true,
  isActive: true,
  permissions: true,
  menuAccess: true,
  lineNotifications: true,
} satisfies Prisma.RoleSelect;
