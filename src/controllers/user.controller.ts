import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password";
import { userPublicSelect, serializeUser } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { AppError } from "../middleware/error";
import type { CreateUserInput, UpdateUserInput } from "../schemas/user.schema";

function keyFromEmail(email: string) {
  const local = email.split("@")[0] || "user";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** Resolve a roleId from {roleId|roleCode}; the role must exist and be active. */
async function resolveRoleId(input: { roleId?: string; roleCode?: string }) {
  const role = input.roleId
    ? await prisma.role.findUnique({ where: { id: input.roleId } })
    : input.roleCode
      ? await prisma.role.findUnique({ where: { code: input.roleCode } })
      : null;
  if (!role) throw new AppError(400, "ไม่พบบทบาทที่ระบุ (Role not found)");
  if (!role.isActive) throw new AppError(400, "บทบาทนี้ถูกปิดใช้งาน (Role inactive)");
  return role.id;
}

export async function listUsers(_req: Request, res: Response) {
  const users = await prisma.user.findMany({
    select: userPublicSelect,
    orderBy: { createdAt: "asc" },
  });
  res.json({ users: users.map(serializeUser) });
}

export async function getUser(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: userPublicSelect,
  });
  if (!user) throw new AppError(404, "ไม่พบผู้ใช้");
  res.json({ user: serializeUser(user) });
}

export async function createUser(req: Request, res: Response) {
  const data = req.body as CreateUserInput;
  const roleId = await resolveRoleId(data);

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: await hashPassword(data.password),
      roleId,
      avatarKey: data.avatarKey ?? keyFromEmail(data.email),
      active: data.active ?? true,
    },
    select: userPublicSelect,
  });

  await logActivity({
    userId: req.user!.id,
    action: "user.create",
    message: `เพิ่มผู้ใช้ ${user.name} เข้าทีม`,
    entityType: "user",
    entityId: user.id,
  });

  res.status(201).json({ user: serializeUser(user) });
}

export async function updateUser(req: Request, res: Response) {
  const data = req.body as UpdateUserInput;
  const roleId =
    data.roleId || data.roleCode ? await resolveRoleId(data) : undefined;

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      name: data.name,
      avatarKey: data.avatarKey,
      active: data.active,
      ...(roleId ? { roleId } : {}),
    },
    select: userPublicSelect,
  });
  res.json({ user: serializeUser(user) });
}

export async function toggleActive(req: Request, res: Response) {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) throw new AppError(404, "ไม่พบผู้ใช้");

  const user = await prisma.user.update({
    where: { id: target.id },
    data: { active: !target.active },
    select: userPublicSelect,
  });

  await logActivity({
    userId: req.user!.id,
    action: "user.toggleActive",
    message: `${user.active ? "เปิดใช้งาน" : "ปิดใช้งาน"} ${user.name}`,
    entityType: "user",
    entityId: user.id,
  });

  res.json({ user: serializeUser(user) });
}

export async function deleteUser(req: Request, res: Response) {
  if (req.params.id === req.user!.id) {
    throw new AppError(400, "ไม่สามารถลบบัญชีของตนเองได้");
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).send();
}
