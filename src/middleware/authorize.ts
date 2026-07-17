import type { NextFunction, Request, Response } from "express";
import { AppError } from "./error";
import { isFullAdmin, isTeamManager, hasPermission } from "../lib/authz";
import type { Permission } from "../lib/roles";

/**
 * Restrict a route to the given role codes. Use after `authenticate`.
 * Backward-compatible: an exact code match still passes; additionally, a role
 * that holds the equivalent capability permission passes the ADMIN/MANAGER
 * tiers (so custom roles work without hardcoding their codes here).
 */
export function authorize(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(401, "ต้องเข้าสู่ระบบก่อน"));
    if (codes.includes(req.user.role)) return next();
    if (codes.includes("ADMIN") && isFullAdmin(req)) return next();
    if (codes.includes("MANAGER") && isTeamManager(req)) return next();
    return next(new AppError(403, "ไม่มีสิทธิ์ดำเนินการ (Forbidden)"));
  };
}

/**
 * Restrict a route to holders of ANY of the given fine-grained capabilities.
 * Capability implications apply (ADMIN_FULL → all, TEAM_MANAGE → manager set),
 * so system ADMIN/MANAGER roles and equivalent custom roles both pass. Use this
 * for new fine-grained guards instead of scattering role-code checks.
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(401, "ต้องเข้าสู่ระบบก่อน"));
    if (permissions.some((p) => hasPermission(req, p))) return next();
    return next(new AppError(403, "ไม่มีสิทธิ์ดำเนินการ (Forbidden)"));
  };
}

/** Managers + admins may perform most team-management actions. */
export const isManagerOrAdmin = authorize("MANAGER", "ADMIN");

/** Admin-only (roles, user management, destructive actions). */
export const isAdmin = authorize("ADMIN");

/** True for manager or admin role codes. */
export function isManagerRole(code: string): boolean {
  return code === "MANAGER" || code === "ADMIN";
}
