import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/error";

/** Latest notifications for the current user (own only). */
export async function listNotifications(req: Request, res: Response) {
  const take = Math.min(Number(req.query.limit) || 20, 50);
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
    take,
  });
  res.json({ notifications });
}

/** Unread count for the bell badge. */
export async function unreadCount(req: Request, res: Response) {
  const count = await prisma.notification.count({
    where: { userId: req.user!.id, isRead: false },
  });
  res.json({ count });
}

/** Mark a single notification read (must belong to the current user). */
export async function markRead(req: Request, res: Response) {
  const existing = await prisma.notification.findUnique({
    where: { id: req.params.id },
    select: { userId: true },
  });
  if (!existing || existing.userId !== req.user!.id) {
    throw new AppError(404, "ไม่พบการแจ้งเตือน");
  }
  const notification = await prisma.notification.update({
    where: { id: req.params.id },
    data: { isRead: true },
  });
  res.json({ notification });
}

/** Mark every notification of the current user read. */
export async function markAllRead(req: Request, res: Response) {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ message: "อ่านทั้งหมดแล้ว" });
}

/** Delete a single notification (must belong to the current user). */
export async function deleteNotification(req: Request, res: Response) {
  const existing = await prisma.notification.findUnique({
    where: { id: req.params.id },
    select: { userId: true },
  });
  if (!existing || existing.userId !== req.user!.id) {
    throw new AppError(404, "ไม่พบการแจ้งเตือน");
  }
  await prisma.notification.delete({ where: { id: req.params.id } });
  res.status(204).send();
}

/** Delete all of the current user's notifications. */
export async function clearNotifications(req: Request, res: Response) {
  await prisma.notification.deleteMany({ where: { userId: req.user!.id } });
  res.status(204).send();
}
