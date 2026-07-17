import type { Request } from "express";
import { PERMISSIONS } from "./roles";

/**
 * Capability predicates. Backward-compatible: the legacy ADMIN/MANAGER role
 * *codes* grant access on their own, and a role's `permissions` grant the same
 * capabilities to custom roles. Purely additive — no existing role loses access.
 */

function permsOf(req: Request): string[] {
  return req.user?.permissions ?? [];
}

/** Full-admin access: the ADMIN code or the ADMIN_FULL permission. */
export function isFullAdmin(req: Request): boolean {
  return req.user?.role === "ADMIN" || permsOf(req).includes(PERMISSIONS.ADMIN_FULL);
}

/** Team-management access: MANAGER/ADMIN code, or TEAM_MANAGE/ADMIN_FULL. */
export function isTeamManager(req: Request): boolean {
  const role = req.user?.role;
  if (role === "MANAGER" || role === "ADMIN") return true;
  const perms = permsOf(req);
  return (
    perms.includes(PERMISSIONS.TEAM_MANAGE) || perms.includes(PERMISSIONS.ADMIN_FULL)
  );
}
