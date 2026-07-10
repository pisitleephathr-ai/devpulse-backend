import type { Request, Response } from "express";
import type { LeaveStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { AppError } from "../middleware/error";
import type { CreateLeaveInput, LeaveQuery } from "../schemas/leave.schema";

const include = {
  user: { select: userMiniSelect },
  reviewedBy: { select: userMiniSelect },
};

const TYPE_LABEL: Record<string, string> = {
  VACATION: "ลาพักร้อน",
  SICK: "ลาป่วย",
  PERSONAL: "ลากิจ",
  PARENTAL: "ลาเลี้ยงดูบุตร",
};

function inclusiveDays(start: Date, end: Date) {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export async function listLeaves(req: Request, res: Response) {
  const q = req.query as unknown as LeaveQuery;
  const isManager = req.user!.role === "MANAGER" || req.user!.role === "ADMIN";
  const where: Prisma.LeaveRequestWhereInput = {
    // Non-managers only see their own requests; managers/admins see all.
    userId: isManager ? q.userId : req.user!.id,
    type: q.type,
    status: q.status,
  };
  const leaves = await prisma.leaveRequest.findMany({
    where,
    include,
    orderBy: { createdAt: "desc" },
  });
  res.json({ leaves });
}

export async function getLeave(req: Request, res: Response) {
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: req.params.id },
    include,
  });
  if (!leave) throw new AppError(404, "ไม่พบคำขอลา");
  res.json({ leave });
}

export async function createLeave(req: Request, res: Response) {
  const data = req.body as CreateLeaveInput;

  const userId =
    data.userId &&
    (req.user!.role === "MANAGER" || req.user!.role === "ADMIN")
      ? data.userId
      : req.user!.id;

  const leave = await prisma.leaveRequest.create({
    data: {
      userId,
      type: data.type,
      startDate: data.startDate,
      endDate: data.endDate,
      days: inclusiveDays(data.startDate, data.endDate),
      reason: data.reason.trim(),
      status: "PENDING",
    },
    include,
  });

  await logActivity({
    userId: req.user!.id,
    action: "leave.create",
    message: `${leave.user.name} ขอ${TYPE_LABEL[leave.type]}`,
    entityType: "leave",
    entityId: leave.id,
  });

  res.status(201).json({ leave });
}

/** Shared approve/reject handler. */
async function decide(req: Request, res: Response, status: LeaveStatus) {
  const existing = await prisma.leaveRequest.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { name: true } } },
  });
  if (!existing) throw new AppError(404, "ไม่พบคำขอลา");
  if (existing.status !== "PENDING") {
    throw new AppError(409, "คำขอนี้ถูกดำเนินการไปแล้ว");
  }

  const leave = await prisma.leaveRequest.update({
    where: { id: req.params.id },
    data: { status, reviewedById: req.user!.id },
    include,
  });

  const verb = status === "APPROVED" ? "อนุมัติ" : "ปฏิเสธ";
  await logActivity({
    userId: req.user!.id,
    action: status === "APPROVED" ? "leave.approve" : "leave.reject",
    message: `${verb}คำขอ${TYPE_LABEL[leave.type]}ของ ${existing.user.name}`,
    entityType: "leave",
    entityId: leave.id,
  });

  res.json({ leave });
}

export function approveLeave(req: Request, res: Response) {
  return decide(req, res, "APPROVED");
}

export function rejectLeave(req: Request, res: Response) {
  return decide(req, res, "REJECTED");
}
