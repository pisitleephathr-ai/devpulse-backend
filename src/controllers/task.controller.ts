import type { Request, Response } from "express";
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { AppError } from "../middleware/error";
import type {
  CreateTaskInput,
  TaskQuery,
  UpdateTaskInput,
} from "../schemas/task.schema";

const include = {
  assignee: { select: userMiniSelect },
  project: { select: { id: true, name: true, code: true, color: true } },
};

export async function listTasks(req: Request, res: Response) {
  const q = req.query as unknown as TaskQuery;
  const where: Prisma.TaskWhereInput = {
    projectId: q.projectId,
    assigneeId: q.assigneeId,
    status: q.status,
  };

  const tasks = await prisma.task.findMany({
    where,
    include,
    orderBy: { createdAt: "asc" },
  });
  res.json({ tasks });
}

export async function getTask(req: Request, res: Response) {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include,
  });
  if (!task) throw new AppError(404, "ไม่พบงาน");
  res.json({ task });
}

export async function createTask(req: Request, res: Response) {
  const data = req.body as CreateTaskInput;
  const task = await prisma.task.create({
    data: {
      title: data.title.trim(),
      projectId: data.projectId,
      assigneeId: data.assigneeId ?? null,
      priority: data.priority ?? "MEDIUM",
      status: data.status ?? "TODO",
      dueDate: data.dueDate ?? null,
    },
    include,
  });

  await logActivity({
    userId: req.user!.id,
    action: "task.create",
    message: `สร้างงานใหม่ "${task.title}"`,
    entityType: "task",
    entityId: task.id,
  });

  res.status(201).json({ task });
}

/** Managers/admins may edit any task; others only their own assigned task. */
async function assertCanEdit(req: Request) {
  if (req.user!.role === "MANAGER" || req.user!.role === "ADMIN") return;
  const existing = await prisma.task.findUnique({
    where: { id: req.params.id },
    select: { assigneeId: true },
  });
  if (!existing) throw new AppError(404, "ไม่พบงาน");
  if (existing.assigneeId !== req.user!.id) {
    throw new AppError(403, "แก้ไขได้เฉพาะงานที่ได้รับมอบหมายให้คุณ");
  }
}

export async function updateTask(req: Request, res: Response) {
  await assertCanEdit(req);
  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: req.body as UpdateTaskInput,
    include,
  });
  res.json({ task });
}

export async function updateTaskStatus(req: Request, res: Response) {
  await assertCanEdit(req);
  const status = (req.body as { status: TaskStatus }).status;
  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: { status },
    include,
  });

  await logActivity({
    userId: req.user!.id,
    action: "task.status",
    message: `ย้าย "${task.title}" ไป ${status}`,
    entityType: "task",
    entityId: task.id,
  });

  res.json({ task });
}

export async function deleteTask(req: Request, res: Response) {
  await prisma.task.delete({ where: { id: req.params.id } });
  res.status(204).send();
}
