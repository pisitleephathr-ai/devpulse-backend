import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { notify } from "../lib/notify";
import { isTeamManager } from "../lib/authz";
import {
  getBangkokDateString,
  startOfBangkokDayUtc,
  bangkokDateToUtcRange,
} from "../lib/date";
import { AppError } from "../middleware/error";
import type {
  CreateActionItemInput,
  UpdateActionItemInput,
  ActionItemQuery,
} from "../schemas/action-item.schema";

const include = {
  assignee: { select: userMiniSelect },
  createdBy: { select: userMiniSelect },
} as const;

/** Attach a `carried` flag: the item was raised on an earlier Bangkok day. */
function serialize(item: {
  date: Date;
  [k: string]: unknown;
}, standupDay: string) {
  return { ...item, carried: getBangkokDateString(item.date) < standupDay };
}

/**
 * GET /api/action-items?date=YYYY-MM-DD — the action items relevant to a
 * standup: every still-OPEN item raised on or before that day (carried forward),
 * plus items completed on that day (to show closure). Any authenticated user.
 */
export async function listActionItems(req: Request, res: Response) {
  const q = req.query as unknown as ActionItemQuery;
  const day = q.date || getBangkokDateString();
  // Upper bound: end of the standup Bangkok day (exclusive) so "today's" items
  // count as raised on/before the standup.
  const dayEnd = new Date(startOfBangkokDayUtc(day).getTime() + 24 * 60 * 60 * 1000);
  const { gte, lt } = bangkokDateToUtcRange(day);

  const [open, doneToday] = await Promise.all([
    prisma.actionItem.findMany({
      where: { status: "OPEN", date: { lt: dayEnd } },
      include,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    prisma.actionItem.findMany({
      where: { status: "DONE", completedAt: { gte, lt } },
      include,
      orderBy: { completedAt: "desc" },
    }),
  ]);

  res.json({
    date: day,
    open: open.map((i) => serialize(i, day)),
    doneToday: doneToday.map((i) => serialize(i, day)),
    openCount: open.length,
  });
}

export async function createActionItem(req: Request, res: Response) {
  const data = req.body as CreateActionItemInput;
  const day = data.date || getBangkokDateString();

  const item = await prisma.actionItem.create({
    data: {
      text: data.text.trim(),
      date: startOfBangkokDayUtc(day),
      dueDate: data.dueDate ? startOfBangkokDayUtc(data.dueDate) : null,
      assigneeId: data.assigneeId || null,
      createdById: req.user!.id,
    },
    include,
  });

  await logActivity({
    userId: req.user!.id,
    action: "action_item.create",
    message: `เพิ่ม action item: ${item.text.slice(0, 60)}`,
    entityType: "action_item",
    entityId: item.id,
  });

  // Notify the assignee (if someone other than the creator).
  if (item.assigneeId && item.assigneeId !== req.user!.id) {
    await notify({
      userId: item.assigneeId,
      type: "action_item.assigned",
      title: "ได้รับมอบหมาย action item",
      message: item.text.slice(0, 120),
      entityType: "action_item",
      entityId: item.id,
    });
  }

  res.status(201).json({ item: serialize(item, getBangkokDateString()) });
}

/** Only the creator or a team manager may edit/remove an item. */
function canManage(req: Request, createdById: string) {
  return req.user!.id === createdById || isTeamManager(req);
}

export async function updateActionItem(req: Request, res: Response) {
  const id = req.params.id;
  const data = req.body as UpdateActionItemInput;
  const existing = await prisma.actionItem.findUnique({
    where: { id },
    select: { createdById: true, assigneeId: true, status: true },
  });
  if (!existing) throw new AppError(404, "ไม่พบ action item");

  // Toggling done/open is a lightweight team action (creator, current assignee,
  // or a manager). Editing text/assignee/due is restricted to creator/manager.
  const onlyStatus =
    data.status !== undefined &&
    data.text === undefined &&
    data.assigneeId === undefined &&
    data.dueDate === undefined;
  const isAssignee = existing.assigneeId === req.user!.id;
  if (!(canManage(req, existing.createdById) || (onlyStatus && isAssignee))) {
    throw new AppError(403, "ไม่มีสิทธิ์แก้ไข action item นี้");
  }

  const patch: Record<string, unknown> = {};
  if (data.text !== undefined) patch.text = data.text.trim();
  if (data.assigneeId !== undefined) patch.assigneeId = data.assigneeId || null;
  if (data.dueDate !== undefined)
    patch.dueDate = data.dueDate ? startOfBangkokDayUtc(data.dueDate) : null;
  if (data.status !== undefined) {
    patch.status = data.status;
    patch.completedAt =
      data.status === "DONE"
        ? existing.status === "DONE"
          ? undefined
          : new Date()
        : null;
  }

  const item = await prisma.actionItem.update({ where: { id }, data: patch, include });

  // Notify a newly-assigned user.
  if (
    data.assigneeId &&
    data.assigneeId !== existing.assigneeId &&
    data.assigneeId !== req.user!.id
  ) {
    await notify({
      userId: data.assigneeId,
      type: "action_item.assigned",
      title: "ได้รับมอบหมาย action item",
      message: item.text.slice(0, 120),
      entityType: "action_item",
      entityId: item.id,
    });
  }

  res.json({ item: serialize(item, getBangkokDateString()) });
}

export async function deleteActionItem(req: Request, res: Response) {
  const existing = await prisma.actionItem.findUnique({
    where: { id: req.params.id },
    select: { createdById: true },
  });
  if (!existing) throw new AppError(404, "ไม่พบ action item");
  if (!canManage(req, existing.createdById))
    throw new AppError(403, "ไม่มีสิทธิ์ลบ action item นี้");

  await prisma.actionItem.delete({ where: { id: req.params.id } });
  res.status(204).send();
}
