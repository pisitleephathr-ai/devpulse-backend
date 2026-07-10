import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { AppError } from "../middleware/error";
import type {
  CreateCommentInput,
  UpdateCommentInput,
} from "../schemas/comment.schema";

const include = { author: { select: userMiniSelect } };

async function ensureTask(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true },
  });
  if (!task) throw new AppError(404, "ไม่พบงาน");
  return task;
}

function isManager(req: Request) {
  return req.user!.role === "MANAGER" || req.user!.role === "ADMIN";
}

/** List non-deleted comments on a task (any authenticated user may view). */
export async function listComments(req: Request, res: Response) {
  await ensureTask(req.params.taskId);
  const comments = await prisma.taskComment.findMany({
    where: { taskId: req.params.taskId, isDeleted: false },
    orderBy: { createdAt: "asc" },
    include,
  });
  res.json({ comments });
}

export async function createComment(req: Request, res: Response) {
  const task = await ensureTask(req.params.taskId);
  const { message } = req.body as CreateCommentInput;

  const comment = await prisma.taskComment.create({
    data: { taskId: task.id, authorId: req.user!.id, message: message.trim() },
    include,
  });

  await logActivity({
    userId: req.user!.id,
    action: "comment.create",
    message: `แสดงความคิดเห็นในงาน "${task.title}"`,
    entityType: "task",
    entityId: task.id,
  });

  res.status(201).json({ comment });
}

/** Only the author may edit their own comment. */
export async function updateComment(req: Request, res: Response) {
  const existing = await prisma.taskComment.findUnique({
    where: { id: req.params.commentId },
    select: { id: true, authorId: true, isDeleted: true, taskId: true },
  });
  if (!existing || existing.isDeleted || existing.taskId !== req.params.taskId)
    throw new AppError(404, "ไม่พบความคิดเห็น");
  if (existing.authorId !== req.user!.id)
    throw new AppError(403, "แก้ไขได้เฉพาะความคิดเห็นของตนเอง");

  const { message } = req.body as UpdateCommentInput;
  const comment = await prisma.taskComment.update({
    where: { id: existing.id },
    data: { message: message.trim(), isEdited: true },
    include,
  });

  await logActivity({
    userId: req.user!.id,
    action: "comment.update",
    message: "แก้ไขความคิดเห็น",
    entityType: "task",
    entityId: existing.taskId,
  });

  res.json({ comment });
}

/** Author may delete their own; managers/admins may moderate any. Soft delete. */
export async function deleteComment(req: Request, res: Response) {
  const existing = await prisma.taskComment.findUnique({
    where: { id: req.params.commentId },
    select: { id: true, authorId: true, isDeleted: true, taskId: true },
  });
  if (!existing || existing.isDeleted || existing.taskId !== req.params.taskId)
    throw new AppError(404, "ไม่พบความคิดเห็น");
  if (existing.authorId !== req.user!.id && !isManager(req))
    throw new AppError(403, "ไม่มีสิทธิ์ลบความคิดเห็นนี้");

  await prisma.taskComment.update({
    where: { id: existing.id },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  await logActivity({
    userId: req.user!.id,
    action: "comment.delete",
    message: "ลบความคิดเห็น",
    entityType: "task",
    entityId: existing.taskId,
  });

  res.status(204).send();
}
