import type { Request, Response } from "express";
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { notifyMany } from "../lib/notify";
import { pushToLineGroup } from "../lib/line";
import { isTeamManager } from "../lib/authz";
import { AppError } from "../middleware/error";
import type {
  AttachmentInput,
  CreateTaskInput,
  LinkInput,
  TaskQuery,
  UpdateTaskInput,
} from "../schemas/task.schema";

const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "รอดำเนินการ",
  IN_PROGRESS: "กำลังทำ",
  REVIEW: "รอตรวจ",
  DONE: "เสร็จแล้ว",
};

const include = {
  assignee: { select: userMiniSelect },
  assignees: {
    include: { user: { select: userMiniSelect } },
    orderBy: { assignedAt: "asc" },
  },
  project: { select: { id: true, name: true, code: true, color: true } },
} satisfies Prisma.TaskInclude;

const listInclude = {
  ...include,
  _count: { select: { links: true, attachments: true, comments: true } },
  // Just the done flags — enough to show "3/5" progress on a board card.
  checklist: { select: { done: true } },
} satisfies Prisma.TaskInclude;

const detailInclude = {
  ...include,
  links: { orderBy: { createdAt: "asc" } },
  attachments: { orderBy: { createdAt: "asc" } },
  checklist: { orderBy: { order: "asc" } },
} satisfies Prisma.TaskInclude;

/** Flatten the join rows into a plain `assignees` user array for the client. */
function flatten<T extends { assignees: { user: unknown }[] }>(task: T) {
  return { ...task, assignees: task.assignees.map((a) => a.user) };
}

/** List-card shape: flatten assignees + collapse the checklist into counts. */
function flattenListRow<
  T extends { assignees: { user: unknown }[]; checklist: { done: boolean }[] }
>(task: T) {
  const { checklist, ...rest } = flatten(task);
  return {
    ...rest,
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((c) => c.done).length,
  };
}

/** Assignee ids from the request, preferring assigneeIds, falling back to the
    legacy single assigneeId. De-duplicated. */
function resolveAssigneeIds(data: {
  assigneeIds?: string[];
  assigneeId?: string | null;
}): string[] {
  const ids =
    data.assigneeIds ?? (data.assigneeId ? [data.assigneeId] : []);
  return [...new Set(ids.filter(Boolean))];
}

export async function listTasks(req: Request, res: Response) {
  const q = req.query as unknown as TaskQuery;
  const where: Prisma.TaskWhereInput = {
    projectId: q.projectId,
    status: q.status,
    priority: q.priority,
    // Match tasks where the selected user is ANY of the assignees.
    ...(q.assigneeId ? { assignees: { some: { userId: q.assigneeId } } } : {}),
    ...(q.search
      ? {
          OR: [
            { title: { contains: q.search, mode: "insensitive" } },
            { description: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(q.dueFrom || q.dueTo ? { dueDate: { gte: q.dueFrom, lte: q.dueTo } } : {}),
  };

  const tasks = await prisma.task.findMany({
    where,
    include: listInclude,
    orderBy: { createdAt: "asc" },
  });
  res.json({ tasks: tasks.map(flattenListRow) });
}

export async function getTask(req: Request, res: Response) {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: detailInclude,
  });
  if (!task) throw new AppError(404, "ไม่พบงาน");
  res.json({ task: flatten(task) });
}

export async function createTask(req: Request, res: Response) {
  const data = req.body as CreateTaskInput;
  const assigneeIds = resolveAssigneeIds(data);

  const task = await prisma.task.create({
    data: {
      title: data.title.trim(),
      description: data.description?.trim() ?? "",
      projectId: data.projectId,
      // Keep the legacy primary assignee in sync for backward compatibility.
      assigneeId: assigneeIds[0] ?? null,
      priority: data.priority ?? "MEDIUM",
      status: data.status ?? "TODO",
      dueDate: data.dueDate ?? null,
      assignees: assigneeIds.length
        ? { create: assigneeIds.map((userId) => ({ userId, assignedById: req.user!.id })) }
        : undefined,
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

  await notifyMany(
    assigneeIds.filter((id) => id !== req.user!.id),
    {
      type: "task.assigned",
      title: "ได้รับมอบหมายงานใหม่",
      message: `คุณได้รับมอบหมายงาน "${task.title}"`,
      entityType: "task",
      entityId: task.id,
    }
  );

  // Announce the new task to the team's LINE group (once per task).
  const names = task.assignees.map((a) => a.user.name).join(", ") || "ยังไม่มอบหมาย";
  await pushToLineGroup(
    `📋 งานใหม่ [${task.project.code}]\n"${task.title}"\nผู้รับผิดชอบ: ${names}`
  );

  res.status(201).json({ task: flatten(task) });
}

/** Managers/admins may edit any task; others only tasks they are assigned to. */
async function assertCanEdit(req: Request, taskId: string) {
  if (isTeamManager(req)) return;
  const existing = await prisma.task.findUnique({
    where: { id: taskId },
    select: { assigneeId: true, assignees: { select: { userId: true } } },
  });
  if (!existing) throw new AppError(404, "ไม่พบงาน");
  const isAssignee =
    existing.assigneeId === req.user!.id ||
    existing.assignees.some((a) => a.userId === req.user!.id);
  if (!isAssignee) {
    throw new AppError(403, "แก้ไขได้เฉพาะงานที่ได้รับมอบหมายให้คุณ");
  }
}

export async function updateTask(req: Request, res: Response) {
  const id = req.params.id;
  await assertCanEdit(req, id);
  const { links, attachments, assigneeIds, ...scalar } =
    req.body as UpdateTaskInput;

  const before = await prisma.task.findUnique({
    where: { id },
    select: { assignees: { select: { userId: true } } },
  });
  const beforeIds = new Set(before?.assignees.map((a) => a.userId) ?? []);
  const nextIds = assigneeIds ? [...new Set(assigneeIds.filter(Boolean))] : null;

  const task = await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id },
      data: {
        ...scalar,
        // Keep the legacy primary in sync when assignees change.
        ...(nextIds ? { assigneeId: nextIds[0] ?? null } : {}),
      },
    });

    if (nextIds) {
      await tx.taskAssignee.deleteMany({ where: { taskId: id } });
      if (nextIds.length)
        await tx.taskAssignee.createMany({
          data: nextIds.map((userId) => ({ taskId: id, userId, assignedById: req.user!.id })),
        });
    }

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
    action: nextIds ? "task.assignees" : "task.update",
    message: nextIds
      ? `อัปเดตผู้รับผิดชอบงาน "${task!.title}"`
      : `แก้ไขงาน "${task!.title}"`,
    entityType: "task",
    entityId: id,
  });

  // Notify only newly-added assignees (not already assigned, not the actor).
  if (nextIds) {
    const added = nextIds.filter((uid) => !beforeIds.has(uid) && uid !== req.user!.id);
    await notifyMany(added, {
      type: "task.assigned",
      title: "ได้รับมอบหมายงาน",
      message: `คุณได้รับมอบหมายงาน "${task!.title}"`,
      entityType: "task",
      entityId: id,
    });
  }

  res.json({ task: flatten(task!) });
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

  // Notify every assignee except whoever moved it.
  await notifyMany(
    task.assignees.map((a) => a.userId).filter((uid) => uid !== req.user!.id),
    {
      type: "task.status",
      title: "สถานะงานเปลี่ยนแปลง",
      message: `"${task.title}" ถูกย้ายไป ${STATUS_LABEL[status]}`,
      entityType: "task",
      entityId: task.id,
    }
  );

  // Announce the status change to the team's LINE group.
  await pushToLineGroup(
    `🔄 [${task.project.code}] "${task.title}"\n→ ${STATUS_LABEL[status]}`
  );

  res.json({ task: flatten(task) });
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
  // Ensure the link actually belongs to this task (prevents cross-task IDOR).
  const link = await prisma.taskLink.findUnique({
    where: { id: req.params.linkId },
    select: { taskId: true },
  });
  if (!link || link.taskId !== req.params.taskId)
    throw new AppError(404, "ไม่พบลิงก์");
  await prisma.taskLink.delete({ where: { id: req.params.linkId } });
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
  // Ensure the attachment actually belongs to this task (prevents IDOR).
  const attachment = await prisma.taskAttachment.findUnique({
    where: { id: req.params.attachmentId },
    select: { taskId: true },
  });
  if (!attachment || attachment.taskId !== req.params.taskId)
    throw new AppError(404, "ไม่พบไฟล์แนบ");
  await prisma.taskAttachment.delete({ where: { id: req.params.attachmentId } });
  res.status(204).send();
}
