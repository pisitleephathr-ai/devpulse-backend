import type { Request, Response } from "express";
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { notifyMany } from "../lib/notify";
import {
  pushFlexToLineGroup,
  pushFlexToUsersWithPref,
  appBaseUrl,
  getLinePrefs,
} from "../lib/line";
import { taskCreatedFlex, taskStatusFlex } from "../lib/line-messages";
import { isTeamManager, hasPermission } from "../lib/authz";
import { PERMISSIONS } from "../lib/roles";
import * as cld from "../lib/cloudinary";
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
  READY_TO_TEST: "พร้อมทดสอบ",
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
  _count: {
    select: {
      links: true,
      // Exclude soft-deleted (DELETE_FAILED) attachments from the board count.
      attachments: { where: { deletedAt: null } },
      comments: true,
    },
  },
  // Just the done flags — enough to show "3/5" progress on a board card.
  checklist: { select: { done: true } },
} satisfies Prisma.TaskInclude;

const detailInclude = {
  ...include,
  links: { orderBy: { createdAt: "asc" } },
  // Hide soft-deleted attachments whose remote delete is still pending retry.
  attachments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
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

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
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
    // Audit log shares the task's transaction: both commit or neither does,
    // so a failed log can never leave a task saved with a 500 (→ retry dup).
    await logActivity(
      {
        userId: req.user!.id,
        action: "task.create",
        message: `สร้างงานใหม่ "${created.title}"`,
        entityType: "task",
        entityId: created.id,
      },
      tx
    );
    return created;
  });

  // Side effects run AFTER commit and must never fail the request (a LINE or
  // notification error must not 500 a task that was created successfully).
  try {
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

    {
      const prefs = await getLinePrefs();
      const creator = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { name: true },
      });
      const base = appBaseUrl();
      const card = taskCreatedFlex(
        {
          title: task.title,
          projectName: task.project.name,
          projectCode: task.project.code,
          priority: task.priority,
          status: task.status,
          dueDate: task.dueDate,
          assignees: task.assignees.map((a) => a.user.name),
          actorName: creator?.name ?? "ระบบ",
        },
        base ? `${base}/tasks?task=${task.id}` : undefined
      );
      // Group card respects the team toggle; personal DMs respect each
      // assignee's own preference (independent of the group setting).
      if (prefs.notifyNewTask) await pushFlexToLineGroup(card.altText, card.contents);
      await pushFlexToUsersWithPref(
        assigneeIds.filter((id) => id !== req.user!.id),
        "taskAssigned",
        card.altText,
        card.contents
      );
    }
  } catch (err) {
    console.warn("[task.create] post-commit side-effect failed:", err);
  }

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
    select: { status: true, assignees: { select: { userId: true } } },
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
      // The edit form only manages URL/link attachments. Cloudinary uploads are
      // managed by the dedicated upload/delete endpoints and MUST survive an
      // edit — so only the URL-source rows are replaced here.
      await tx.taskAttachment.deleteMany({ where: { taskId: id, source: "URL" } });
      if (attachments.length)
        await tx.taskAttachment.createMany({
          data: attachments.map((a) => ({
            taskId: id,
            source: "URL",
            kind: "LINK",
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
    // DM each newly-added assignee on their personal LINE (per-user pref).
    if (added.length && task) {
      const actor = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { name: true },
      });
      const base = appBaseUrl();
      const card = taskCreatedFlex(
        {
          title: task.title,
          projectName: task.project.name,
          projectCode: task.project.code,
          priority: task.priority,
          status: task.status,
          dueDate: task.dueDate,
          assignees: task.assignees.map((a) => a.user.name),
          actorName: actor?.name ?? "ระบบ",
        },
        base ? `${base}/tasks?task=${task.id}` : undefined
      );
      await pushFlexToUsersWithPref(added, "taskAssigned", card.altText, card.contents);
    }
  }

  // If this edit changed the status to TODO/DONE, announce it on LINE too — so
  // changing status via the edit form behaves like dragging the card.
  if (
    task &&
    before &&
    task.status !== before.status &&
    (await getLinePrefs()).statuses.includes(task.status)
  ) {
    const mover = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { name: true },
    });
    const base = appBaseUrl();
    const statusCard = taskStatusFlex(
      {
        title: task.title,
        projectName: task.project.name,
        projectCode: task.project.code,
        fromStatus: before.status,
        toStatus: task.status,
        actorName: mover?.name ?? "ระบบ",
      },
      base ? `${base}/tasks?task=${task.id}` : undefined
    );
    await pushFlexToLineGroup(statusCard.altText, statusCard.contents);
  }

  res.json({ task: flatten(task!) });
}

export async function updateTaskStatus(req: Request, res: Response) {
  await assertCanEdit(req, req.params.id);
  const status = (req.body as { status: TaskStatus }).status;
  // Capture the previous status so the LINE card can show "from → to".
  const before = await prisma.task.findUnique({
    where: { id: req.params.id },
    select: { status: true },
  });
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

  // Announce the status change to LINE — only for statuses the team enabled,
  // and only when the status actually changed.
  if (
    before?.status !== status &&
    (await getLinePrefs()).statuses.includes(status)
  ) {
    const mover = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { name: true },
    });
    const base = appBaseUrl();
    const statusCard = taskStatusFlex(
      {
        title: task.title,
        projectName: task.project.name,
        projectCode: task.project.code,
        fromStatus: before?.status ?? null,
        toStatus: status,
        actorName: mover?.name ?? "ระบบ",
      },
      base ? `${base}/tasks?task=${task.id}` : undefined
    );
    await pushFlexToLineGroup(statusCard.altText, statusCard.contents);
  }

  res.json({ task: flatten(task) });
}

export async function deleteTask(req: Request, res: Response) {
  const id = req.params.id;
  // Collect Cloudinary assets BEFORE deleting the task (the cascade removes the
  // attachment rows), then purge them from Cloudinary so nothing is orphaned.
  const assets = await prisma.taskAttachment.findMany({
    where: { taskId: id, source: "CLOUDINARY", cloudinaryPublicId: { not: null } },
    select: { cloudinaryPublicId: true, cloudinaryResourceType: true },
  });

  await prisma.task.delete({ where: { id } });

  // Best-effort remote cleanup — never blocks the response. A failure is logged
  // (publicId only, never a secret); the periodic cleanup job is the backstop.
  if (cld.isConfigured() && assets.length) {
    for (const a of assets) {
      if (!a.cloudinaryPublicId) continue;
      const rt = a.cloudinaryResourceType === "raw" ? "raw" : "image";
      cld.deleteAsset(a.cloudinaryPublicId, rt).catch((err) =>
        console.error(
          `[task.delete] Cloudinary delete failed publicId=${a.cloudinaryPublicId}:`,
          err instanceof Error ? err.message : err
        )
      );
    }
  }

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
  const { taskId, attachmentId } = req.params;

  // Fetch first so we can both check task membership (IDOR) and authorize by
  // uploader — without leaking existence to unauthorized callers.
  const attachment = await prisma.taskAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      taskId: true,
      source: true,
      uploadedById: true,
      fileName: true,
      deletedAt: true,
      cloudinaryPublicId: true,
      cloudinaryResourceType: true,
      task: { select: { title: true, assigneeId: true, assignees: { select: { userId: true } } } },
    },
  });
  if (!attachment || attachment.taskId !== taskId || attachment.deletedAt)
    throw new AppError(404, "ไม่พบไฟล์แนบ");

  // Authorization: a team manager, the TASK_ATTACHMENT_DELETE capability, or the
  // person who uploaded the file. Legacy URL attachments (no uploader) remain
  // deletable by an assignee, preserving the pre-upload behavior.
  const uid = req.user!.id;
  const isManager =
    isTeamManager(req) || hasPermission(req, PERMISSIONS.TASK_ATTACHMENT_DELETE);
  const isUploader = !!attachment.uploadedById && attachment.uploadedById === uid;
  const isLegacyAssignee =
    attachment.source === "URL" &&
    (attachment.task.assigneeId === uid ||
      attachment.task.assignees.some((a) => a.userId === uid));
  if (!isManager && !isUploader && !isLegacyAssignee) {
    throw new AppError(403, "คุณไม่มีสิทธิ์ลบไฟล์นี้");
  }

  // Remove the Cloudinary asset first (external side effect). If it fails we do
  // NOT silently report success: soft-delete the row (freeing task capacity and
  // hiding it) with DELETE_FAILED so the cleanup job retries, and log the error
  // (attachmentId + publicId only — never any secret).
  const publicId = attachment.cloudinaryPublicId;
  const resourceType =
    attachment.cloudinaryResourceType === "raw" ? "raw" : "image";
  let remoteDeletePending = false;

  if (attachment.source === "CLOUDINARY" && publicId && cld.isConfigured()) {
    try {
      const result = await cld.deleteAsset(publicId, resourceType);
      if (result !== "ok" && result !== "not found") {
        remoteDeletePending = true;
        console.error(
          `[attachment] Cloudinary delete returned "${result}" for attachment=${attachment.id} publicId=${publicId}`
        );
      }
    } catch (err) {
      remoteDeletePending = true;
      console.error(
        `[attachment] Cloudinary delete FAILED for attachment=${attachment.id} publicId=${publicId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    if (remoteDeletePending) {
      // Keep the row for retry, but treat it as gone everywhere else.
      await tx.taskAttachment.update({
        where: { id: attachment.id },
        data: { deleteStatus: "DELETE_FAILED", deletedAt: new Date() },
      });
    } else {
      await tx.taskAttachment.delete({ where: { id: attachment.id } });
    }
    await logActivity(
      {
        userId: uid,
        action: "task.attachment.delete",
        message: `ลบไฟล์ "${attachment.fileName}" จากงาน "${attachment.task.title}"`,
        entityType: "task",
        entityId: taskId,
      },
      tx
    );
  });

  if (remoteDeletePending) {
    // Honest signal: the DB record is removed but the remote asset deletion is
    // queued for retry (not a clean 204).
    res.status(200).json({ ok: true, remoteDeletePending: true });
    return;
  }
  res.status(204).send();
}
