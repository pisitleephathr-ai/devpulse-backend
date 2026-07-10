import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { userPublicSelect, serializeUser } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { AppError } from "../middleware/error";
import type {
  ChangePasswordInput,
  UpdateProfileInput,
} from "../schemas/profile.schema";

/** The current user's own profile. */
export async function getProfile(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: userPublicSelect,
  });
  if (!user) throw new AppError(404, "ไม่พบผู้ใช้");
  res.json({ user: serializeUser(user) });
}

/** Update only the current user's own name/avatar. Never role or active. */
export async function updateProfile(req: Request, res: Response) {
  const data = req.body as UpdateProfileInput;
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { name: data.name, avatarKey: data.avatarKey },
    select: userPublicSelect,
  });

  await logActivity({
    userId: req.user!.id,
    action: "profile.update",
    message: `${user.name} อัปเดตโปรไฟล์`,
    entityType: "user",
    entityId: user.id,
  });

  res.json({ user: serializeUser(user) });
}

/** Change the current user's own password (verifies the current one). */
export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, password: true },
  });
  if (!user) throw new AppError(404, "ไม่พบผู้ใช้");

  const ok = await verifyPassword(currentPassword, user.password);
  if (!ok) throw new AppError(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง");

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await hashPassword(newPassword) },
  });

  await logActivity({
    userId: req.user!.id,
    action: "password.change",
    message: "เปลี่ยนรหัสผ่าน",
    entityType: "user",
    entityId: user.id,
  });

  res.json({ message: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว" });
}
