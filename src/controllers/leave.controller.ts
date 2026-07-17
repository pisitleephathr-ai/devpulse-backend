import type { Request, Response } from "express";
import type { LeaveStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { notify, notifyMany } from "../lib/notify";
import { pushFlexToLineGroup, appBaseUrl, getLinePrefs } from "../lib/line";
import { leaveFlex } from "../lib/line-messages";
import { isFullAdmin, isTeamManager } from "../lib/authz";
import { AppError } from "../middleware/error";

/** Best-effort LINE card for a leave submit/decision (never throws). */
async function pushLeaveCard(
  status: "PENDING" | "APPROVED" | "REJECTED",
  leave: {
    user: { name: string };
    type: string;
    startDate: Date;
    endDate: Date;
    days: number;
    halfDayPeriod: string | null;
    reason: string | null;
    reviewedBy?: { name: string } | null;
  }
) {
  if (!(await getLinePrefs()).notifyLeave) return;
  const base = appBaseUrl();
  const card = leaveFlex(
    status,
    {
      userName: leave.user.name,
      type: leave.type,
      startDate: leave.startDate,
      endDate: leave.endDate,
      days: leave.days,
      halfDayPeriod: leave.halfDayPeriod,
      reason: leave.reason,
      actorName: leave.reviewedBy?.name ?? null,
    },
    base ? `${base}/leaves` : undefined
  );
  await pushFlexToLineGroup(card.altText, card.contents);
}

/**
 * Ids of active users who can approve leave — recipients of leave-request
 * notifications. Permission-aware: the legacy MANAGER/ADMIN codes OR any role
 * granted TEAM_MANAGE / ADMIN_FULL / LEAVE_APPROVE (so custom roles are
 * notified too, not just the built-in codes).
 */
async function managerIds(): Promise<string[]> {
  const managers = await prisma.user.findMany({
    where: {
      active: true,
      roleRef: {
        is: {
          OR: [
            { code: { in: ["MANAGER", "ADMIN"] } },
            {
              permissions: {
                hasSome: ["TEAM_MANAGE", "ADMIN_FULL", "LEAVE_APPROVE"],
              },
            },
          ],
        },
      },
    },
    select: { id: true },
  });
  return managers.map((m) => m.id);
}
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

/** Half-day leave counts as 0.5; otherwise the inclusive whole-day count. */
function computeDays(start: Date, end: Date, half?: string | null) {
  return half ? 0.5 : inclusiveDays(start, end);
}

const HALF_LABEL: Record<string, string> = {
  MORNING: "ครึ่งวันเช้า",
  AFTERNOON: "ครึ่งวันบ่าย",
};

/** e.g. "1 วัน" or "0.5 วัน (ครึ่งวันเช้า)" */
function daysLabel(days: number, half?: string | null) {
  return half ? `${days} วัน (${HALF_LABEL[half] ?? "ครึ่งวัน"})` : `${days} วัน`;
}

export async function listLeaves(req: Request, res: Response) {
  const q = req.query as unknown as LeaveQuery;
  const isManager = isTeamManager(req);
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
  // Non-managers may only view their own leave request.
  const isManager = isTeamManager(req);
  if (!isManager && leave.userId !== req.user!.id) {
    throw new AppError(403, "ไม่มีสิทธิ์ดูคำขอลานี้");
  }
  res.json({ leave });
}

export async function createLeave(req: Request, res: Response) {
  const data = req.body as CreateLeaveInput;

  const userId =
    data.userId && isTeamManager(req) ? data.userId : req.user!.id;

  const leave = await prisma.$transaction(async (tx) => {
    const created = await tx.leaveRequest.create({
    data: {
      userId,
      type: data.type,
      startDate: data.startDate,
      endDate: data.endDate,
      days: computeDays(data.startDate, data.endDate, data.halfDayPeriod),
      halfDayPeriod: data.halfDayPeriod ?? null,
      reason: data.reason.trim(),
      status: "PENDING",
    },
    include,
    });
    await logActivity(
      {
        userId: req.user!.id,
        action: "leave.create",
        message: `${created.user.name} ขอ${TYPE_LABEL[created.type]}`,
        entityType: "leave",
        entityId: created.id,
      },
      tx
    );
    return created;
  });

  // Side effects run AFTER commit and must never fail the request.
  try {
    const recipients = (await managerIds()).filter((id) => id !== leave.userId);
    await notifyMany(recipients, {
      type: "leave.submitted",
      title: "คำขอลาใหม่",
      message: `${leave.user.name} ขอ${TYPE_LABEL[leave.type]} ${daysLabel(leave.days, leave.halfDayPeriod)}`,
      entityType: "leave",
      entityId: leave.id,
    });
    await pushLeaveCard("PENDING", leave);
  } catch (err) {
    console.warn("[leave.create] post-commit side-effect failed:", err);
  }

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
  // A user may not approve/reject their own leave (admins may override).
  if (existing.userId === req.user!.id && !isFullAdmin(req)) {
    throw new AppError(403, "ไม่สามารถอนุมัติ/ปฏิเสธคำขอลาของตนเองได้");
  }

  const verb = status === "APPROVED" ? "อนุมัติ" : "ปฏิเสธ";
  const leave = await prisma.$transaction(async (tx) => {
    const updated = await tx.leaveRequest.update({
      where: { id: req.params.id },
      data: { status, reviewedById: req.user!.id },
      include,
    });
    await logActivity(
      {
        userId: req.user!.id,
        action: status === "APPROVED" ? "leave.approve" : "leave.reject",
        message: `${verb}คำขอ${TYPE_LABEL[updated.type]}ของ ${existing.user.name}`,
        entityType: "leave",
        entityId: updated.id,
      },
      tx
    );
    return updated;
  });

  // Side effects run AFTER commit and must never fail the request.
  try {
    // Notify the requester of the decision (unless they reviewed their own).
    if (leave.userId !== req.user!.id) {
      await notify({
        userId: leave.userId,
        type: status === "APPROVED" ? "leave.approved" : "leave.rejected",
        title: status === "APPROVED" ? "คำขอลาได้รับอนุมัติ" : "คำขอลาถูกปฏิเสธ",
        message: `คำขอ${TYPE_LABEL[leave.type]}ของคุณถูก${verb}แล้ว`,
        entityType: "leave",
        entityId: leave.id,
      });
    }
    await pushLeaveCard(status === "APPROVED" ? "APPROVED" : "REJECTED", leave);
  } catch (err) {
    console.warn("[leave.decide] post-commit side-effect failed:", err);
  }

  res.json({ leave });
}

export function approveLeave(req: Request, res: Response) {
  return decide(req, res, "APPROVED");
}

export function rejectLeave(req: Request, res: Response) {
  return decide(req, res, "REJECTED");
}

/**
 * Withdraw/cancel a leave request. The owner may cancel their own request while
 * it is still PENDING; managers/admins may remove any request.
 */
export async function deleteLeave(req: Request, res: Response) {
  const existing = await prisma.leaveRequest.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { name: true } } },
  });
  if (!existing) throw new AppError(404, "ไม่พบคำขอลา");

  const isManager = isTeamManager(req);
  const isOwner = existing.userId === req.user!.id;
  if (!isManager && !(isOwner && existing.status === "PENDING")) {
    throw new AppError(403, "ยกเลิกได้เฉพาะคำขอลาของตนเองที่ยังรออนุมัติ");
  }

  await prisma.leaveRequest.delete({ where: { id: req.params.id } });

  await logActivity({
    userId: req.user!.id,
    action: "leave.delete",
    message: `ยกเลิกคำขอ${TYPE_LABEL[existing.type]}ของ ${existing.user.name}`,
    entityType: "leave",
    entityId: existing.id,
  });

  res.status(204).send();
}
