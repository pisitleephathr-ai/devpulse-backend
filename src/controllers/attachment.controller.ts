import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logActivity } from "../lib/activity";
import { AppError } from "../middleware/error";
import { isTeamManager, hasPermission } from "../lib/authz";
import { PERMISSIONS } from "../lib/roles";
import {
  uploadConfig,
  validateFileMeta,
  kindForMime,
  maxBytesForKind,
  resourceTypeForKind,
  extensionOf,
  UPLOAD_LIMITS,
} from "../lib/upload-limits";
import * as cld from "../lib/cloudinary";
import type { CompleteInput, SignatureInput } from "../schemas/upload.schema";

/* ------------------------------ helpers -------------------------------- */

/** Signed uploads are unavailable until Cloudinary is configured. */
function assertCloudinaryReady() {
  if (!cld.isConfigured()) {
    throw new AppError(503, "ระบบอัปโหลดไฟล์ยังไม่พร้อมใช้งาน");
  }
}

/**
 * Authorize an attachment WRITE (upload) on a task. Allowed when the user is a
 * team manager/admin, holds TASK_ATTACHMENT_UPLOAD, or is an assignee of the
 * task. Returns the task (id + title) for downstream use. Any authenticated user
 * may VIEW a task (matching getTask), but uploading is gated.
 */
async function assertCanUpload(
  req: Request,
  taskId: string
): Promise<{ id: string; title: string }> {
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

  if (
    isTeamManager(req) ||
    hasPermission(req, PERMISSIONS.TASK_ATTACHMENT_UPLOAD)
  ) {
    return { id: task.id, title: task.title };
  }
  const uid = req.user!.id;
  const isAssignee =
    task.assigneeId === uid || task.assignees.some((a) => a.userId === uid);
  if (!isAssignee) {
    throw new AppError(403, "คุณไม่มีสิทธิ์แนบไฟล์ในงานนี้");
  }
  return { id: task.id, title: task.title };
}

/** Live usage for a task, computed from the DB (never trust the client). */
async function computeUsage(taskId: string) {
  const rows = await prisma.taskAttachment.findMany({
    where: { taskId, deletedAt: null },
    select: { fileSize: true },
  });
  const fileCount = rows.length;
  const totalBytes = rows.reduce((sum, r) => sum + (r.fileSize ?? 0), 0);
  return {
    fileCount,
    totalBytes,
    remainingFileCount: Math.max(0, UPLOAD_LIMITS.maxFilesPerTask - fileCount),
    remainingBytes: Math.max(0, UPLOAD_LIMITS.maxTotalBytesPerTask - totalBytes),
  };
}

/** Shape a stored attachment row for the client. */
const attachmentSelect = {
  id: true,
  source: true,
  kind: true,
  fileName: true,
  fileUrl: true,
  fileType: true,
  fileSize: true,
  originalName: true,
  displayName: true,
  mimeType: true,
  extension: true,
  secureUrl: true,
  thumbnailUrl: true,
  width: true,
  height: true,
  cloudinaryResourceType: true,
  uploadedById: true,
  createdAt: true,
} satisfies Prisma.TaskAttachmentSelect;

/* ------------------------------ endpoints ------------------------------ */

/** GET /api/uploads/config — the limits + allowlists (source of truth). */
export async function getUploadConfig(_req: Request, res: Response) {
  res.json(uploadConfig());
}

/** GET /api/tasks/:taskId/attachments/usage — live usage vs. limits. */
export async function getTaskAttachmentUsage(req: Request, res: Response) {
  // Viewing usage only requires that the task exists (any authenticated user
  // can already view the task + its attachments).
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    select: { id: true },
  });
  if (!task) throw new AppError(404, "ไม่พบงาน");

  const usage = await computeUsage(task.id);
  res.json({
    usage,
    limits: {
      maxFiles: UPLOAD_LIMITS.maxFilesPerTask,
      maxTotalBytes: UPLOAD_LIMITS.maxTotalBytesPerTask,
    },
  });
}

/**
 * POST /api/tasks/:taskId/attachments/signature
 * Authorize + validate the declared file, reserve capacity, and return signed
 * Cloudinary upload parameters. Records an UploadIntent that the complete step
 * consumes exactly once (replay / duplicate protection).
 */
export async function createSignature(req: Request, res: Response) {
  assertCloudinaryReady();
  const taskId = req.params.taskId;
  await assertCanUpload(req, taskId);

  const body = req.body as SignatureInput;

  // MIME + extension + per-file size (shared with complete → cannot drift).
  const meta = validateFileMeta({
    fileName: body.fileName,
    mimeType: body.mimeType,
    fileSize: body.fileSize,
  });
  if (!meta.ok) throw new AppError(400, meta.error);

  // Capacity: file count + total space (computed from real DB rows).
  const usage = await computeUsage(taskId);
  if (usage.fileCount >= UPLOAD_LIMITS.maxFilesPerTask) {
    throw new AppError(
      400,
      `แนบไฟล์ครบ ${UPLOAD_LIMITS.maxFilesPerTask} ไฟล์แล้ว กรุณาลบไฟล์เดิมก่อน`
    );
  }
  if (usage.totalBytes + body.fileSize > UPLOAD_LIMITS.maxTotalBytesPerTask) {
    throw new AppError(
      400,
      `พื้นที่ของงานไม่เพียงพอ เหลือ ${mb(usage.remainingBytes)} แต่ไฟล์นี้มีขนาด ${mb(body.fileSize)}`
    );
  }

  const publicId = cld.newPublicId();
  const folder = cld.taskFolder(taskId);
  const fullPublicId = `${folder}/${publicId}`;
  const resourceType = resourceTypeForKind(meta.kind);

  const sig = cld.createUploadSignature({ taskId, publicId, kind: meta.kind });

  // Reserve the upload. The unique publicId + PENDING status makes this
  // single-use; the cleanup job removes the Cloudinary asset if it is never
  // confirmed before expiry.
  await prisma.uploadIntent.create({
    data: {
      taskId,
      userId: req.user!.id,
      publicId: fullPublicId,
      fileName: body.fileName.slice(0, 255),
      mimeType: body.mimeType.slice(0, 100),
      expectedSize: body.fileSize,
      resourceType,
      status: "PENDING",
      expiresAt: new Date(Date.now() + sig.expiresIn * 1000),
    },
  });

  res.json(sig);
}

/**
 * POST /api/tasks/:taskId/attachments/complete
 * Confirm a finished Cloudinary upload. Verifies the UploadIntent, inspects the
 * real asset via the Admin API, re-checks every limit against the REAL metadata,
 * then persists the attachment + activity log in one transaction.
 */
export async function completeUpload(req: Request, res: Response) {
  assertCloudinaryReady();
  const taskId = req.params.taskId;
  const task = await assertCanUpload(req, taskId);
  const body = req.body as CompleteInput;

  // 1) The intent must exist, belong to this user + task, be PENDING, unexpired,
  //    and its publicId must match exactly (single-use, no replay).
  const intent = await prisma.uploadIntent.findUnique({
    where: { publicId: body.publicId },
  });
  if (
    !intent ||
    intent.taskId !== taskId ||
    intent.userId !== req.user!.id ||
    intent.status !== "PENDING"
  ) {
    throw new AppError(400, "คำขออัปโหลดไม่ถูกต้องหรือถูกใช้ไปแล้ว");
  }
  if (intent.expiresAt.getTime() < Date.now()) {
    throw new AppError(400, "คำขออัปโหลดหมดอายุ กรุณาอัปโหลดใหม่");
  }
  if (intent.resourceType !== body.resourceType) {
    throw new AppError(400, "ชนิดทรัพยากรไม่ตรงกับคำขอ");
  }

  // 2) The publicId must live in this task's folder (defense-in-depth).
  if (!cld.validatePublicId(body.publicId, taskId)) {
    throw new AppError(400, "ไฟล์ไม่ได้อยู่ในโฟลเดอร์ของงานนี้");
  }

  // 3) MIME/format allowlist against the CLIENT-declared mime (a first gate;
  //    the authoritative size/format check uses the inspected asset below).
  const kind = kindForMime(body.mimeType);
  if (!kind) throw new AppError(400, `ไม่รองรับไฟล์ประเภท ${body.mimeType}`);
  if (resourceTypeForKind(kind) !== body.resourceType) {
    throw new AppError(400, "ชนิดไฟล์และชนิดทรัพยากรไม่ตรงกัน");
  }

  // 4) Inspect the REAL asset from Cloudinary — the source of truth. This
  //    defeats a client that forges fileSize / secureUrl / format / dimensions.
  const asset = await cld.inspectAsset(body.publicId, body.resourceType);
  if (!asset) {
    throw new AppError(400, "ไม่พบไฟล์บน Cloudinary");
  }
  if (!cld.validateCloudinaryFolder(asset.folder, taskId)) {
    throw new AppError(400, "ไฟล์ไม่ได้อยู่ในโฟลเดอร์ของงานนี้");
  }
  if (asset.resourceType !== body.resourceType) {
    throw new AppError(400, "ชนิดทรัพยากรไม่ถูกต้อง");
  }
  // Real size must respect the per-file ceiling for the kind.
  if (asset.bytes <= 0 || asset.bytes > maxBytesForKind(kind)) {
    throw new AppError(400, `ขนาดไฟล์เกินกำหนดสำหรับ${kind === "IMAGE" ? "รูปภาพ" : "เอกสาร"}`);
  }

  const assetId = asset.assetId ?? body.assetId;

  // 5) assetId must be new (also enforced by the unique index — caught below).
  const existing = await prisma.taskAttachment.findFirst({
    where: { cloudinaryAssetId: assetId },
    select: { id: true },
  });
  if (existing) throw new AppError(409, "ไฟล์นี้ถูกบันทึกไปแล้ว");

  // 6) Re-check task capacity with the REAL byte size.
  const usage = await computeUsage(taskId);
  if (usage.fileCount >= UPLOAD_LIMITS.maxFilesPerTask) {
    throw new AppError(400, `แนบไฟล์ครบ ${UPLOAD_LIMITS.maxFilesPerTask} ไฟล์แล้ว`);
  }
  if (usage.totalBytes + asset.bytes > UPLOAD_LIMITS.maxTotalBytesPerTask) {
    throw new AppError(400, "พื้นที่ของงานไม่เพียงพอ");
  }

  const ext = extensionOf(intent.fileName) || extensionOf(body.originalName);
  const thumbnailUrl =
    kind === "IMAGE" ? cld.buildThumbnailUrl(body.publicId, asset.version) : null;

  // 7) Persist + mark intent consumed + activity, atomically. A unique-violation
  //    on cloudinaryAssetId (concurrent double-complete) surfaces as 409.
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const attachment = await tx.taskAttachment.create({
        data: {
          taskId,
          source: "CLOUDINARY",
          kind,
          // Legacy mirror fields so old readers + the URL renderer still work.
          fileName: body.originalName.slice(0, 255),
          fileUrl: asset.secureUrl,
          fileType: kind === "IMAGE" ? "image" : "file",
          fileSize: asset.bytes,
          originalName: body.originalName.slice(0, 255),
          mimeType: body.mimeType.slice(0, 100),
          extension: ext || null,
          cloudinaryPublicId: asset.publicId,
          cloudinaryVersion: asset.version,
          cloudinaryAssetId: assetId,
          cloudinaryResourceType: asset.resourceType,
          cloudinaryFormat: asset.format,
          secureUrl: asset.secureUrl,
          thumbnailUrl,
          width: asset.width,
          height: asset.height,
          uploadedById: req.user!.id,
        },
        select: attachmentSelect,
      });

      const marked = await tx.uploadIntent.updateMany({
        where: { id: intent.id, status: "PENDING" },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      // If the intent was already consumed by a concurrent request, abort so we
      // don't create a duplicate attachment.
      if (marked.count === 0) throw new AppError(409, "ไฟล์นี้ถูกบันทึกไปแล้ว");

      await logActivity(
        {
          userId: req.user!.id,
          action: "task.attachment.upload",
          message: `อัปโหลดไฟล์ "${body.originalName}" ในงาน "${task.title}"`,
          entityType: "task",
          entityId: taskId,
        },
        tx
      );
      return attachment;
    });
  } catch (err) {
    if (isUniqueViolation(err) || err instanceof AppError) {
      if (err instanceof AppError) throw err;
      throw new AppError(409, "ไฟล์นี้ถูกบันทึกไปแล้ว");
    }
    throw err;
  }

  res.status(201).json({ attachment: created });
}

/* ------------------------------ utils ---------------------------------- */

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}
