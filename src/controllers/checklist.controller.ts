import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { logActivity } from "../lib/activity";
import { isTeamManager } from "../lib/authz";
import { AppError } from "../middleware/error";
import type {
  CreateChecklistItemInput,
  UpdateChecklistItemInput,
} from "../schemas/checklist.schema";

/**
 * Managers/admins may edit any task's checklist; otherwise the user must be one
 * of the task's assignees (legacy single assignee or the multi-assignee set).
 */
async function ensureCanModify(req: Request, taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      assigneeId: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!task) throw new AppError(404, "ไม่พบงาน");
  if (isTeamManager(req)) return task;
  const uid = req.user!.id;
  const isAssignee =
    task.assigneeId === uid || task.assignees.some((a) => a.userId === uid);
  if (!isAssignee) throw new AppError(403, "แก้ไขได้เฉพาะงานที่รับผิดชอบ");
  return task;
}

async function ensureItem(taskId: string, itemId: string) {
  const item = await prisma.taskChecklistItem.findUnique({
    where: { id: itemId },
    select: { id: true, taskId: true },
  });
  if (!item || item.taskId !== taskId)
    throw new AppError(404, "ไม่พบรายการ");
  return item;
}

export async function addChecklistItem(req: Request, res: Response) {
  const task = await ensureCanModify(req, req.params.taskId);
  const { text } = req.body as CreateChecklistItemInput;

  const last = await prisma.taskChecklistItem.findFirst({
    where: { taskId: task.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const item = await prisma.taskChecklistItem.create({
    data: { taskId: task.id, text: text.trim(), order: (last?.order ?? -1) + 1 },
  });

  await logActivity({
    userId: req.user!.id,
    action: "task.checklist.add",
    message: `เพิ่มรายการย่อยในงาน "${task.title}"`,
    entityType: "task",
    entityId: task.id,
  });

  res.status(201).json({ item });
}

export async function updateChecklistItem(req: Request, res: Response) {
  await ensureCanModify(req, req.params.taskId);
  await ensureItem(req.params.taskId, req.params.itemId);
  const data = req.body as UpdateChecklistItemInput;

  const item = await prisma.taskChecklistItem.update({
    where: { id: req.params.itemId },
    data: {
      ...(data.text !== undefined ? { text: data.text.trim() } : {}),
      ...(data.done !== undefined ? { done: data.done } : {}),
    },
  });

  res.json({ item });
}

export async function deleteChecklistItem(req: Request, res: Response) {
  await ensureCanModify(req, req.params.taskId);
  await ensureItem(req.params.taskId, req.params.itemId);

  await prisma.taskChecklistItem.delete({ where: { id: req.params.itemId } });

  res.status(204).send();
}
