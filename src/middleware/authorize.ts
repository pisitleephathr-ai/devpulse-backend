import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { AppError } from "./error";

/** Restrict a route to the given roles. Use after `authenticate`. */
export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(401, "ต้องเข้าสู่ระบบก่อน"));
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, "ไม่มีสิทธิ์ดำเนินการ (Forbidden)"));
    }
    next();
  };
}

/** Managers + admins may perform team-management actions. */
export const isManagerOrAdmin = authorize("MANAGER", "ADMIN");
