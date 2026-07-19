import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { userPublicSelect, serializeUser } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { env } from "../lib/env";
import { pushMessagesToUser } from "../lib/line";
import { issueLinkCode } from "../lib/line-link";
import { allowedNotifKeys } from "../lib/line-notif";
import { AppError } from "../middleware/error";
import type {
  ChangePasswordInput,
  LinePrefsInput,
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

/* ------------------------- Personal LINE linking ------------------------- */

/** GET /api/profile/line — the current user's personal-LINE link status + prefs. */
export async function getLineStatus(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      lineUserId: true,
      lineLinkedAt: true,
      lineNotifyTaskAssigned: true,
      lineNotifyLeaveDecision: true,
      lineNotifyReportReminder: true,
      roleRef: { select: { lineNotifications: true } },
    },
  });
  res.json({
    linked: !!user?.lineUserId,
    linkedAt: user?.lineLinkedAt ?? null,
    lineEnabled: env.LINE_ENABLED,
    addFriendUrl: env.LINE_ADD_FRIEND_URL ?? null,
    // Only the types this user's role allows are shown as toggles.
    available: allowedNotifKeys(user?.roleRef?.lineNotifications),
    prefs: {
      taskAssigned: user?.lineNotifyTaskAssigned ?? true,
      leaveDecision: user?.lineNotifyLeaveDecision ?? true,
      reportReminder: user?.lineNotifyReportReminder ?? true,
    },
  });
}

/** PATCH /api/profile/line/prefs — update the current user's DM preferences. */
export async function updateLinePrefs(req: Request, res: Response) {
  const body = req.body as LinePrefsInput;
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      ...(body.taskAssigned !== undefined && {
        lineNotifyTaskAssigned: body.taskAssigned,
      }),
      ...(body.leaveDecision !== undefined && {
        lineNotifyLeaveDecision: body.leaveDecision,
      }),
      ...(body.reportReminder !== undefined && {
        lineNotifyReportReminder: body.reportReminder,
      }),
    },
    select: {
      lineNotifyTaskAssigned: true,
      lineNotifyLeaveDecision: true,
      lineNotifyReportReminder: true,
    },
  });
  res.json({
    prefs: {
      taskAssigned: user.lineNotifyTaskAssigned,
      leaveDecision: user.lineNotifyLeaveDecision,
      reportReminder: user.lineNotifyReportReminder,
    },
  });
}

/**
 * POST /api/profile/line/link-code — issue (or replace) a short-lived code the
 * user sends to the OA in a 1:1 chat to bind their personal LINE account.
 */
export async function createLineLinkCode(req: Request, res: Response) {
  const { code, expiresAt } = await issueLinkCode(req.user!.id);
  res.json({ code, expiresAt, addFriendUrl: env.LINE_ADD_FRIEND_URL ?? null });
}

/** POST /api/profile/line/test — send a test DM to verify the link works. */
export async function testLineDm(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { lineUserId: true, name: true },
  });
  if (!user?.lineUserId) throw new AppError(400, "ยังไม่ได้เชื่อมต่อ LINE");
  if (!env.LINE_ENABLED) throw new AppError(503, "ระบบ LINE ยังไม่เปิดใช้งาน");
  await pushMessagesToUser(req.user!.id, [
    {
      type: "text",
      text: `🔔 ทดสอบการแจ้งเตือนส่วนตัวจาก DevPulse\nสวัสดีคุณ${user.name} — การเชื่อมต่อทำงานปกติแล้วครับ`,
    },
  ]);
  res.json({ sent: true });
}

/** DELETE /api/profile/line — unlink the current user's personal LINE account. */
export async function unlinkLine(req: Request, res: Response) {
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { lineUserId: null, lineLinkedAt: null },
  });
  // Drop any pending code too (best-effort).
  await prisma.lineLinkCode
    .deleteMany({ where: { userId: req.user!.id } })
    .catch(() => {});
  res.json({ linked: false });
}
