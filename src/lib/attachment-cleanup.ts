import { prisma } from "./prisma";
import * as cld from "./cloudinary";

/** How often the in-process cleanup timer fires (spec: at least once a day). */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

/**
 * Reconcile Cloudinary with the database so no asset is ever leaked or wrongly
 * removed. Two passes, both best-effort (never throw):
 *
 *  1. Orphaned uploads — an UploadIntent that expired while still PENDING means
 *     the client uploaded to Cloudinary (or started to) but never confirmed. If
 *     NO TaskAttachment references that publicId, the asset is orphaned: delete
 *     it from Cloudinary and mark the intent EXPIRED. We NEVER delete an asset
 *     that already has a TaskAttachment (a confirmed upload).
 *
 *  2. Failed deletions — a TaskAttachment soft-deleted with DELETE_FAILED had a
 *     remote-delete error at request time. Retry the Cloudinary deletion; on
 *     success remove the row for good.
 *
 * Returns a small summary for logging. Safe to run frequently and concurrently
 * (each unit of work is idempotent).
 */
export type CleanupSummary = {
  orphansDeleted: number;
  orphansSkipped: number;
  intentsExpired: number;
  failedRetriedOk: number;
  failedStillPending: number;
  errors: number;
};

export async function runAttachmentCleanup(now = new Date()): Promise<CleanupSummary> {
  const summary: CleanupSummary = {
    orphansDeleted: 0,
    orphansSkipped: 0,
    intentsExpired: 0,
    failedRetriedOk: 0,
    failedStillPending: 0,
    errors: 0,
  };

  if (!cld.isConfigured()) return summary;

  // ---- Pass 1: expired, unconfirmed intents --------------------------------
  const expired = await prisma.uploadIntent.findMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    take: 200,
  });

  for (const intent of expired) {
    try {
      // Never touch an asset that became a real attachment.
      const attached = await prisma.taskAttachment.findFirst({
        where: { cloudinaryPublicId: intent.publicId },
        select: { id: true },
      });
      if (attached) {
        summary.orphansSkipped += 1;
      } else {
        const resourceType = intent.resourceType === "raw" ? "raw" : "image";
        const result = await cld.deleteAsset(intent.publicId, resourceType);
        if (result === "ok" || result === "not found") {
          summary.orphansDeleted += 1;
        } else {
          console.error(
            `[cleanup] orphan delete returned "${result}" for publicId=${intent.publicId}`
          );
          summary.errors += 1;
        }
      }
      await prisma.uploadIntent.update({
        where: { id: intent.id },
        data: { status: "EXPIRED" },
      });
      summary.intentsExpired += 1;
    } catch (err) {
      summary.errors += 1;
      console.error(
        `[cleanup] failed to process intent=${intent.id} publicId=${intent.publicId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // ---- Pass 2: retry failed remote deletions -------------------------------
  const failed = await prisma.taskAttachment.findMany({
    where: { deleteStatus: "DELETE_FAILED", deletedAt: { not: null } },
    select: { id: true, cloudinaryPublicId: true, cloudinaryResourceType: true },
    take: 200,
  });

  for (const row of failed) {
    if (!row.cloudinaryPublicId) {
      // Nothing remote to remove — drop the row.
      await prisma.taskAttachment.delete({ where: { id: row.id } }).catch(() => {});
      summary.failedRetriedOk += 1;
      continue;
    }
    try {
      const resourceType = row.cloudinaryResourceType === "raw" ? "raw" : "image";
      const result = await cld.deleteAsset(row.cloudinaryPublicId, resourceType);
      if (result === "ok" || result === "not found") {
        await prisma.taskAttachment.delete({ where: { id: row.id } });
        summary.failedRetriedOk += 1;
      } else {
        summary.failedStillPending += 1;
      }
    } catch (err) {
      summary.failedStillPending += 1;
      console.error(
        `[cleanup] retry delete FAILED for attachment=${row.id} publicId=${row.cloudinaryPublicId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return summary;
}

/** Run cleanup once and log the summary. Best-effort — never throws. */
async function runOnce(): Promise<void> {
  try {
    const s = await runAttachmentCleanup();
    if (
      s.orphansDeleted ||
      s.intentsExpired ||
      s.failedRetriedOk ||
      s.failedStillPending ||
      s.errors
    ) {
      console.log("[cleanup] attachment cleanup:", JSON.stringify(s));
    }
  } catch (e) {
    console.warn("[cleanup] attachment cleanup error:", e);
  }
}

/**
 * Arm the periodic attachment cleanup (orphan sweep + failed-delete retry).
 * No-op unless Cloudinary is configured. Runs once at boot and every 6 hours.
 */
export function startAttachmentCleanup(): void {
  if (!cld.isConfigured()) {
    console.log("[cleanup] Cloudinary not configured — attachment cleanup off");
    return;
  }
  setInterval(() => void runOnce(), CLEANUP_INTERVAL_MS);
  void runOnce();
  console.log("[cleanup] attachment cleanup armed (every 6h)");
}
