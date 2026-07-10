import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { signToken } from "../lib/jwt";
import { userPublicSelect, serializeUser } from "../lib/selects";
import { AppError } from "../middleware/error";
import type { LoginInput, RegisterInput } from "../schemas/auth.schema";

/** Derive an avatar key from an email local part, e.g. "ben@x" -> "Ben". */
function keyFromEmail(email: string) {
  const local = email.split("@")[0] || "user";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** roleId for a role code (defaults to DEVELOPER). */
async function roleIdForCode(code: string) {
  const role =
    (await prisma.role.findUnique({ where: { code } })) ??
    (await prisma.role.findUnique({ where: { code: "DEVELOPER" } }));
  return role?.id;
}

export async function register(req: Request, res: Response) {
  const data = req.body as RegisterInput;

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new AppError(409, "อีเมลนี้ถูกใช้งานแล้ว (Email already in use)");

  const roleId = await roleIdForCode(data.role ?? "DEVELOPER");

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: await hashPassword(data.password),
      roleId,
      avatarKey: data.avatarKey ?? keyFromEmail(data.email),
    },
    select: userPublicSelect,
  });

  const safe = serializeUser(user);
  const token = signToken({ sub: user.id, role: safe.role?.code ?? "DEVELOPER" });
  res.status(201).json({ token, user: safe });
}

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
