import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { logActivity } from "../lib/activity";
import { AppError } from "../middleware/error";
import type { CreateRoleInput, UpdateRoleInput } from "../schemas/role.schema";

export async function listRoles(_req: Request, res: Response) {
  const roles = await prisma.role.findMany({
    orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { users: true } } },
  });
  res.json({ roles });
}

export async function getRole(req: Request, res: Response) {
  const role = await prisma.role.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw new AppError(404, "ไม่พบบทบาท");
  res.json({ role });
}

export async function createRole(req: Request, res: Response) {
  const data = req.body as CreateRoleInput;
  const code = data.code.trim().toUpperCase();

  const existing = await prisma.role.findUnique({ where: { code } });
  if (existing) throw new AppError(409, "รหัสบทบาทนี้ถูกใช้แล้ว (Duplicate code)");

  const role = await prisma.role.create({
    data: {
      name: data.name.trim(),
      code,
      description: data.description?.trim() ?? "",
      isActive: data.isActive ?? true,
      isSystem: false,
      permissions: data.permissions ? [...new Set(data.permissions)] : [],
      assignable: data.assignable ?? true,
      menuAccess: data.menuAccess ? [...new Set(data.menuAccess)] : [],
    },
  });

  await logActivity({
    userId: req.user!.id,
    action: "role.create",
    message: `สร้างบทบาท "${role.name}"`,
    entityType: "role",
    entityId: role.id,
  });

  res.status(201).json({ role });
}

export async function updateRole(req: Request, res: Response) {
  const data = req.body as UpdateRoleInput;
  const role = await prisma.role.findUnique({ where: { id: req.params.id } });
  if (!role) throw new AppError(404, "ไม่พบบทบาท");

  // Never let a system role be deactivated (would lock admins out).
  if (role.isSystem && data.isActive === false) {
    throw new AppError(400, "ไม่สามารถปิดใช้งานบทบาทระบบได้");
  }
  // System roles' capabilities are fixed — don't allow stripping ADMIN_FULL etc.
  if (role.isSystem && data.permissions) {
    throw new AppError(400, "ไม่สามารถแก้สิทธิ์ของบทบาทระบบได้");
  }

  const updated = await prisma.role.update({
    where: { id: role.id },
    data: {
      name: data.name,
      description: data.description,
      isActive: data.isActive,
      // "assignable" is a team-membership flag, not a capability — allow it to
      // be toggled on system roles too (unlike permissions, gated above).
      assignable: data.assignable,
      // Menu visibility is navigation-only (not a capability) — editable for
      // every role. API routes stay guarded by permissions regardless.
      ...(data.menuAccess ? { menuAccess: [...new Set(data.menuAccess)] } : {}),
      ...(data.permissions
        ? { permissions: [...new Set(data.permissions)] }
        : {}),
    },
  });

  await logActivity({
    userId: req.user!.id,
    action: "role.update",
    message: `แก้ไขบทบาท "${updated.name}"`,
    entityType: "role",
    entityId: updated.id,
  });

  res.json({ role: updated });
}

export async function deleteRole(req: Request, res: Response) {
  const role = await prisma.role.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw new AppError(404, "ไม่พบบทบาท");
  if (role.isSystem) throw new AppError(400, "ไม่สามารถลบบทบาทระบบได้");
  if (role._count.users > 0) {
    throw new AppError(409, "ยังมีผู้ใช้ในบทบาทนี้ กรุณาย้ายผู้ใช้ก่อนลบ");
  }

  await prisma.role.delete({ where: { id: role.id } });

  await logActivity({
    userId: req.user!.id,
    action: "role.delete",
    message: `ลบบทบาท "${role.name}"`,
    entityType: "role",
    entityId: role.id,
  });

  res.status(204).send();
}
