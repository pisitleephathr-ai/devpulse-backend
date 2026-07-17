import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import { AppError } from "./error";

/** Require a valid Bearer token; attaches req.user. */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(401, "ต้องเข้าสู่ระบบก่อน (Missing token)");
    }

    const token = header.slice(7);
    const payload = verifyToken(token);

    // Confirm the user still exists and is active. Read the current role from
    // the DB (via roleRef) so role changes take effect immediately.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        active: true,
        roleRef: { select: { code: true, permissions: true } },
      },
    });

    if (!user || !user.active) {
      throw new AppError(401, "บัญชีถูกปิดใช้งานหรือไม่พบผู้ใช้ (Unauthorized)");
    }

    req.user = {
      id: user.id,
      role: user.roleRef?.code ?? user.role ?? "DEVELOPER",
      permissions: user.roleRef?.permissions ?? [],
    };
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError(401, "โทเคนไม่ถูกต้องหรือหมดอายุ (Invalid token)"));
  }
}
