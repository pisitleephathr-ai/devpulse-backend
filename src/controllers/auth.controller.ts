import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyPassword } from "../lib/password";
import { signToken } from "../lib/jwt";
import { userPublicSelect, serializeUser } from "../lib/selects";
import { AppError } from "../middleware/error";
import type { LoginInput } from "../schemas/auth.schema";

// Public self-registration was removed: it was unauthenticated yet accepted a
// client-supplied `role`, letting anyone create an ADMIN account (and any
// signup could read all team data). Accounts are created by admins via
// `POST /api/users` (isAdmin-gated). Keep auth to login + me only.

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as LoginInput;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { ...userPublicSelect, password: true },
  });
  if (!user || !(await verifyPassword(password, user.password))) {
    throw new AppError(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง (Invalid credentials)");
  }
  if (!user.active) throw new AppError(403, "บัญชีถูกปิดใช้งาน (Account disabled)");

  const { password: _pw, ...rest } = user;
  const safe = serializeUser(rest);
  const token = signToken({ sub: user.id, role: safe.role?.code ?? "DEVELOPER" });
  res.json({ token, user: safe });
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: userPublicSelect,
  });
  res.json({ user: user ? serializeUser(user) : null });
}
