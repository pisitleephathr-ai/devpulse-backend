import type { Request, Response } from "express";
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { notify } from "../lib/notify";
import { AppError } from "../middleware/error";

const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "รอดำเนินการ",
  IN_PROGRESS: "กำลังทำ",
  REVIEW: "รอตรวจ",
  DONE: "เสร็จแล้ว",
};
import type {
  AttachmentInput,
  CreateTaskInput,
  LinkInput,
  TaskQuery,
  UpdateTaskInput,
} from "../schemas/task.schema";

const include = {
  assignee: { select: userMiniSelect },
  project: { select: { id: true, name: true, code: true, color: true } },
};

/** List rows carry link/attachment counts (not the full rows) for card badges. */
const listInclude = {
  ...include,
  _count: { select: { links: true, attachments: true } },
};

/** Detail rows carry the full links + attachments. */
const detailInclude = {
  ...include,
  links: { orderBy: { createdAt: "asc" } },
  attachments: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.TaskInclude;

export async function listTasks(req: Request, res: Response) {
  const q = req.query as unknown as TaskQuery;
  const where: Prisma.TaskWhereInput = {
    projectId: q.projectId,
    assigneeId: q.assigneeId,
    status: q.status,
    priority: q.priority,
    ...(q.search
      ? {
          OR: [
            { title: { contains: q.search, mode: "insensitive" } },
            { description: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(q.dueFrom || q.dueTo
      ? { dueDate: { gte: q.dueFrom, lte: q.dueTo } }
      : {}),
  };

  const tasks = await prisma.task.findMany({
    where,
    include: listInclude,
    orderBy: { createdAt: "asc" },
  });
  res.json({ tasks });
}

export async function getTask(req: Request, res: Response) {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: detailInclude,
  });
  if (!task) throw new AppError(404, "ไม่พบงาน");
  res.json({ task });
}

export async function createTask(req: Request, res: Response) {
  const data = req.body as CreateTaskInput;
  const task = await prisma.task.create({
    data: {
      title: data.title.trim(),
      description: data.description?.trim() ?? "",
      projectId: data.projectId,
      assigneeId: data.assigneeId ?? null,
      priority: data.priority ?? "MEDIUM",
      status: data.status ?? "TODO",
      dueDate: data.dueDate ?? null,
      links: data.links?.length
        ? { create: data.links.map((l) => ({ title: l.title.trim(), url: l.url.trim() })) }
        : undefined,
      attachments: data.attachments?.length
        ? {
            create: data.attachments.map((a) => ({
              fileName: a.fileName.trim(),
              fileUrl: a.fileUrl.trim(),
              fileType: a.fileType,
              fileSize: a.fileSize,
            })),
          }
        : undefined,
    },
    include: detailInclude,
  });

  await logActivity({
    userId: req.user!.id,
    action: "task.create",
    message: `สร้างงานใหม่ "${task.title}"`,
    entityType: "task",
    entityId: task.id,
  });

  // Notify the assignee (unless they assigned it to themselves).
  if (task.assigneeId && task.assigneeId !== req.user!.id) {
    await notify({
      userId: task.assigneeId,
      type: "task.assigned",
      title: "ได้รับมอบหมายงานใหม่",
      message: `คุณได้รับมอบหมายงาน "${task.title}"`,
      entityType: "task",
      entityId: task.id,
    });
  }

  res.status(201).json({ task });
}

/** Managers/admins may edit any task; others only their own assigned task. */
async function assertCanEdit(req: Request, taskId: string) {
  if (req.user!.role === "MANAGER" || req.user!.role === "ADMIN") return;
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    select: { assigneeId: true },
  });
  if (!existing) throw new AppError(404, "ไม่พบงาน");
  if (existing.assigneeId !== req.user!.id) {
    throw new AppError(403, "แก้ไขได้เฉพาะงานที่ได้รับมอบหมายให้คุณ");
  }
}

export async function updateTask(req: Request, res: Response) {
  const id = req.params.id;
  await assertCanEdit(req, id);
  const { links, attachments, ...scalar } = req.body as UpdateTaskInput;

  const before = await prisma.task.findUnique({
    where: { id },
    select: { assigneeId: true },
  });

  const task = await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id }, data: scalar });

    if (links) {
      await tx.taskLink.deleteMany({ where: { taskId: id } });
      if (links.length)
        await tx.taskLink.createMany({
          data: links.map((l) => ({ taskId: id, title: l.title.trim(), url: l.url.trim() })),
        });
    }
    if (attachments) {
      await tx.taskAttachment.deleteMany({ where: { taskId: id } });
      if (attachments.length)
        await tx.taskAttachment.createMany({
          data: attachments.map((a) => ({
            taskId: id,
            fileName: a.fileName.trim(),
            fileUrl: a.fileUrl.trim(),
            fileType: a.fileType,
            fileSize: a.fileSize,
          })),
        });
    }
    return tx.task.findUnique({ where: { id }, include: detailInclude });
  });

  await logActivity({
    userId: req.user!.id,
    action: "task.update",
    message: `แก้ไขงาน "${task!.title}"`,
    entityType: "task",
    entityId: id,
  });

  // Notify a newly-assigned user (assignee changed and isn't the actor).
  if (
    task?.assigneeId &&
    task.assigneeId !== before?.assigneeId &&
    task.assigneeId !== req.user!.id
  ) {
    await notify({
      userId: task.assigneeId,
      type: "task.assigned",
      title: "ได้รับมอบหมายงาน",
      message: `คุณได้รับมอบหมายงาน "${task.title}"`,
      entityType: "task",
      entityId: id,
    });
  }

  res.json({ task });
}

export async function updateTaskStatus(req: Request, res: Response) {
  await assertCanEdit(req, req.params.id);
  const status = (req.body as { status: TaskStatus }).status;
  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: { status },
    include,
  });

  await logActivity({
    userId: req.user!.id,
    action: "task.status",
    message: `ย้าย "${task.title}" ไป ${STATUS_LABEL[status]}`,
    entityType: "task",
    entityId: task.id,
  });

  // Notify the assignee that their task moved (unless they moved it themselves).
  if (task.assigneeId && task.assigneeId !== req.user!.id) {
    await notify({
      userId: task.assigneeId,
      type: "task.status",
      title: "สถานะงานเปลี่ยนแปลง",
      message: `"${task.title}" ถูกย้ายไป ${STATUS_LABEL[status]}`,
      entityType: "task",
      entityId: task.id,
    });
  }

  res.json({ task });
}

export async function deleteTask(req: Request, res: Response) {
  await prisma.task.delete({ where: { id: req.params.id } });
  res.status(204).send();
}

/* --------------------------- Links & attachments ---------------------- */

export async function addLink(req: Request, res: Response) {
  await assertCanEdit(req, req.params.id);
  const { title, url } = req.body as LinkInput;
  const link = await prisma.taskLink.create({
    data: { taskId: req.params.id, title: title.trim(), url: url.trim() },
  });
  res.status(201).json({ link });
}

export async function deleteLink(req: Request, res: Response) {
  await assertCanEdit(req, req.params.taskId);
  await prisma.taskLink.delete({
    where: { id: req.params.linkId },
  });
  res.status(204).send();
}

export async function addAttachment(req: Request, res: Response) {
  await assertCanEdit(req, req.params.id);
  const a = req.body as AttachmentInput;
  const attachment = await prisma.taskAttachment.create({
    data: {
      taskId: req.params.id,
      fileName: a.fileName.trim(),
      fileUrl: a.fileUrl.trim(),
      fileType: a.fileType,
      fileSize: a.fileSize,
    },
  });
  res.status(201).json({ attachment });
}

export async function deleteAttachment(req: Request, res: Response) {
  await assertCanEdit(req, req.params.taskId);
  await prisma.taskAttachment.delete({
    where: { id: req.params.attachmentId },
  });
  res.status(204).send();
}
