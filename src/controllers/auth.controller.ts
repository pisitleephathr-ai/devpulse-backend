import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { signToken } from "../lib/jwt";
import { userPublicSelect } from "../lib/selects";
import { AppError } from "../middleware/error";
import type { LoginInput, RegisterInput } from "../schemas/auth.schema";

/** Derive an avatar key from an email local part, e.g. "ben@x" -> "Ben". */
function keyFromEmail(email: string) {
  const local = email.split("@")[0] || "user";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export async function register(req: Request, res: Response) {
  const data = req.body as RegisterInput;

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new AppError(409, "อีเมลนี้ถูกใช้งานแล้ว (Email already in use)");

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: await hashPassword(data.password),
      role: data.role ?? "DEVELOPER",
      avatarKey: data.avatarKey ?? keyFromEmail(data.email),
    },
    select: userPublicSelect,
  });

  const token = signToken({ sub: user.id, role: user.role });
  res.status(201).json({ token, user });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as LoginInput;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.password))) {
    throw new AppError(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง (Invalid credentials)");
  }
  if (!user.active) throw new AppError(403, "บัญชีถูกปิดใช้งาน (Account disabled)");

  const token = signToken({ sub: user.id, role: user.role });
  const { password: _pw, ...safe } = user;
  res.json({ token, user: safe });
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: userPublicSelect,
  });
  res.json({ user });
}
