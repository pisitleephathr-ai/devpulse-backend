import type { Request } from "express";
import { PERMISSIONS, expandPermissions, type Permission } from "./roles";

/**
 * Capability predicates. Backward-compatible: the legacy ADMIN/MANAGER role
 * *codes* grant access on their own, and a role's `permissions` grant the same
 * (plus tier implications). Purely additive — no existing role loses access.
 * `expandPermissions` is the single source that applies the implication rules.
 */

/** The request user's full effective capability set (grants + implications). */
export function effectivePermissions(req: Request): Set<string> {
  return expandPermissions(req.user?.permissions ?? [], req.user?.role);
}

/** Whether the request user holds a specific capability. */
export function hasPermission(req: Request, permission: Permission): boolean {
  return effectivePermissions(req).has(permission);
}

/** Full-admin access: the ADMIN code or the ADMIN_FULL permission. */
export function isFullAdmin(req: Request): boolean {
  return hasPermission(req, PERMISSIONS.ADMIN_FULL);
}

/** Team-management access: MANAGER/ADMIN code, or TEAM_MANAGE/ADMIN_FULL. */
export function isTeamManager(req: Request): boolean {
  return hasPermission(req, PERMISSIONS.TEAM_MANAGE);
}
