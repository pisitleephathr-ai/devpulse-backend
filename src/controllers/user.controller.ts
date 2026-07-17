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

/**
 * Guard against removing the team's last active admin. `userId` is the user
 * whose admin/active status is about to be reduced (deactivated, deleted, or
 * demoted). No-op unless that user is currently an active ADMIN and the only one.
 */
async function assertNotLastAdmin(userId: string) {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { active: true, roleRef: { select: { code: true } } },
  });
  if (!target || !target.active || target.roleRef?.code !== "ADMIN") return;
  const activeAdmins = await prisma.user.count({
    where: { active: true, roleRef: { is: { code: "ADMIN" } } },
  });
  if (activeAdmins <= 1) {
    throw new AppError(400, "ต้องมีผู้ดูแลระบบ (ADMIN) ที่ใช้งานอยู่อย่างน้อย 1 คน");
  }
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
      requiresDailyReport: data.requiresDailyReport ?? true,
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

  // Don't let this update strip the last active admin (deactivate or demote).
  if (data.active === false) await assertNotLastAdmin(req.params.id);
  if (roleId) {
    const newRole = await prisma.role.findUnique({
      where: { id: roleId },
      select: { code: true },
    });
    if (newRole?.code !== "ADMIN") await assertNotLastAdmin(req.params.id);
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      name: data.name,
      avatarKey: data.avatarKey,
      active: data.active,
      requiresDailyReport: data.requiresDailyReport,
      ...(roleId ? { roleId } : {}),
    },
    select: userPublicSelect,
  });

  await logActivity({
    userId: req.user!.id,
    action: "user.update",
    message: `แก้ไขข้อมูลผู้ใช้ ${user.name}`,
    entityType: "user",
    entityId: user.id,
  });

  res.json({ user: serializeUser(user) });
}

export async function toggleActive(req: Request, res: Response) {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) throw new AppError(404, "ไม่พบผู้ใช้");

  // Deactivating? Ensure it doesn't remove the last active admin.
  if (target.active) await assertNotLastAdmin(target.id);

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
  await assertNotLastAdmin(req.params.id);

  // Hard delete cascades away the user's reports, leaves, and audit trail.
  // Preserve that history: block deletion when it exists (deactivate instead).
  const [reports, leaves] = await Promise.all([
    prisma.dailyReport.count({ where: { authorId: req.params.id } }),
    prisma.leaveRequest.count({ where: { userId: req.params.id } }),
  ]);
  if (reports > 0 || leaves > 0) {
    throw new AppError(
      400,
      "ผู้ใช้นี้มีประวัติรายงานหรือการลา — กรุณาปิดใช้งานแทนการลบเพื่อรักษาข้อมูล"
    );
  }

  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).send();
}
