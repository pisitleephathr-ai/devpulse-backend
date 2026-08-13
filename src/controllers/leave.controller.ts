import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { pushFlexToLineGroup, appBaseUrl, getLinePrefs } from "../lib/line";
import { leaveFlex } from "../lib/line-messages";
import { isTeamManager } from "../lib/authz";
import { getBangkokDateString } from "../lib/date";
import { AppError } from "../middleware/error";
import type { CreateLeaveInput, LeaveQuery } from "../schemas/leave.schema";

const include = {
  user: { select: userMiniSelect },
  reviewedBy: { select: userMiniSelect },
};

// "แจ้งติดธุระ" has a single implicit category — new records default to this
// when the client sends no type. The DB column stays freeform for old rows.
const DEFAULT_TYPE = "ติดธุระ";

function inclusiveDays(start: Date, end: Date) {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/** Half-day counts as 0.5; otherwise the inclusive whole-day count. */
function computeDays(start: Date, end: Date, half?: string | null) {
  return half ? 0.5 : inclusiveDays(start, end);
}

/**
 * "แจ้งติดธุระ" (notify-busy) is self-service: declaring is effective
 * immediately (status APPROVED = active), and the owner may cancel it
 * themselves BEFORE the start date (→ CANCELLED). There is no approver.
 * We keep the APPROVED value as the "active" state so every downstream
 * read path that filters `status: "APPROVED"` (dashboard, calendar, weekly
 * plan, standup, scheduler, bot) keeps working unchanged; CANCELLED rows are
 * naturally excluded from those.
 */

/** Best-effort group LINE card announcing a busy declaration / cancellation. */
async function pushLeaveCard(
  status: "APPROVED" | "CANCELLED",
  leave: {
    user: { name: string };
    type: string;
    startDate: Date;
    endDate: Date;
    days: number;
    halfDayPeriod: string | null;
    reason: string | null;
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
      actorName: null,
    },
    base ? `${base}/leaves` : undefined
  );
  await pushFlexToLineGroup(card.altText, card.contents);
}

export async function listLeaves(req: Request, res: Response) {
  const q = req.query as unknown as LeaveQuery;
  const isManager = isTeamManager(req);
  const where: Prisma.LeaveRequestWhereInput = {
    // Non-managers only see their own; managers/admins see all.
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
  if (!leave) throw new AppError(404, "ไม่พบรายการแจ้งติดธุระ");
  // Non-managers may only view their own.
  const isManager = isTeamManager(req);
  if (!isManager && leave.userId !== req.user!.id) {
    throw new AppError(403, "ไม่มีสิทธิ์ดูรายการนี้");
  }
  res.json({ leave });
}

export async function createLeave(req: Request, res: Response) {
  const data = req.body as CreateLeaveInput;

  // A manager may still file on behalf of a member; otherwise it's for self.
  const userId = data.userId && isTeamManager(req) ? data.userId : req.user!.id;

  const leave = await prisma.$transaction(async (tx) => {
    const created = await tx.leaveRequest.create({
      data: {
        userId,
        type: data.type?.trim() || DEFAULT_TYPE,
        startDate: data.startDate,
        endDate: data.endDate,
        days: computeDays(data.startDate, data.endDate, data.halfDayPeriod),
        halfDayPeriod: data.halfDayPeriod ?? null,
        reason: data.reason?.trim() || "",
        // Active immediately — self-service, no approval.
        status: "APPROVED",
      },
      include,
    });
    await logActivity(
      {
        userId: req.user!.id,
        action: "leave.create",
        message: `${created.user.name} แจ้งติดธุระ`,
        entityType: "leave",
        entityId: created.id,
      },
      tx
    );
    return created;
  });

  // Inform the team group (best-effort — never fails the request).
  try {
    await pushLeaveCard("APPROVED", leave);
  } catch (err) {
    console.warn("[leave.create] LINE card failed:", err);
  }

  res.status(201).json({ leave });
}

/**
 * Cancel one's own busy declaration. Allowed only while it's still active
 * (APPROVED) and STRICTLY BEFORE the Bangkok start date — once the start day
 * arrives it can no longer be cancelled. Sets CANCELLED (kept for history).
 */
export async function cancelLeave(req: Request, res: Response) {
  const existing = await prisma.leaveRequest.findUnique({
    where: { id: req.params.id },
    include,
  });
  if (!existing) throw new AppError(404, "ไม่พบรายการแจ้งติดธุระ");

  if (existing.userId !== req.user!.id) {
    throw new AppError(403, "ยกเลิกได้เฉพาะรายการของตนเอง");
  }
  if (existing.status !== "APPROVED") {
    throw new AppError(409, "รายการนี้ถูกยกเลิกไปแล้ว");
  }
  // Compare Bangkok calendar dates: today must be before the start day.
  const today = getBangkokDateString();
  const startDay = getBangkokDateString(existing.startDate);
  if (!(today < startDay)) {
    throw new AppError(
      400,
      "ยกเลิกได้เฉพาะก่อนวันที่แจ้งไว้ (พ้นวันเริ่มแล้วยกเลิกไม่ได้)"
    );
  }

  const leave = await prisma.$transaction(async (tx) => {
    const updated = await tx.leaveRequest.update({
      where: { id: existing.id },
      data: { status: "CANCELLED" },
      include,
    });
    await logActivity(
      {
        userId: req.user!.id,
        action: "leave.cancel",
        message: `${updated.user.name} ยกเลิกติดธุระ`,
        entityType: "leave",
        entityId: updated.id,
      },
      tx
    );
    return updated;
  });

  try {
    await pushLeaveCard("CANCELLED", leave);
  } catch (err) {
    console.warn("[leave.cancel] LINE card failed:", err);
  }

  res.json({ leave });
}

/**
 * Hard-remove a record. Managers/admins only (cleanup) — members cancel their
 * own via cancelLeave instead.
 */
export async function deleteLeave(req: Request, res: Response) {
  const existing = await prisma.leaveRequest.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { name: true } } },
  });
  if (!existing) throw new AppError(404, "ไม่พบรายการแจ้งติดธุระ");

  if (!isTeamManager(req)) {
    throw new AppError(403, "ลบได้เฉพาะผู้ดูแลทีม");
  }

  await prisma.leaveRequest.delete({ where: { id: req.params.id } });

  await logActivity({
    userId: req.user!.id,
    action: "leave.delete",
    message: `ลบรายการติดธุระของ ${existing.user.name}`,
    entityType: "leave",
    entityId: existing.id,
  });

  res.status(204).send();
}
