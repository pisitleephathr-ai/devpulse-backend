import { Router } from "express";
import * as ctrl from "../controllers/task.controller";
import * as comments from "../controllers/comment.controller";
import * as checklist from "../controllers/checklist.controller";
import * as attachments from "../controllers/attachment.controller";
import { authenticate } from "../middleware/auth";
import { isManagerOrAdmin, requirePermission } from "../middleware/authorize";
import { PERMISSIONS } from "../lib/roles";
import { attachmentLimiter } from "../middleware/rateLimit";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import {
  attachmentSchema,
  createTaskSchema,
  linkSchema,
  reworkSchema,
  taskQuerySchema,
  updateStatusSchema,
  updateTaskSchema,
} from "../schemas/task.schema";
import { createCommentSchema, updateCommentSchema } from "../schemas/comment.schema";
import {
  createChecklistItemSchema,
  updateChecklistItemSchema,
} from "../schemas/checklist.schema";
import {
  signatureSchema,
  completeSchema,
  taskIdParam,
  attachmentParams,
} from "../schemas/upload.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

router.get("/", validate({ query: taskQuerySchema }), asyncHandler(ctrl.listTasks));
router.get("/:id", validate({ params: idParam }), asyncHandler(ctrl.getTask));

// Create: managers/admins, or any role granted the TASK_CREATE capability.
router.post(
  "/",
  requirePermission(PERMISSIONS.TASK_CREATE),
  validate({ body: createTaskSchema }),
  asyncHandler(ctrl.createTask)
);
// Delete stays manager/admin only.
router.delete("/:id", isManagerOrAdmin, validate({ params: idParam }), asyncHandler(ctrl.deleteTask));

// Update / status change: manager/admin (any task) or the assignee (own task).
// Ownership is enforced in the controller.
router.patch(
  "/:id",
  validate({ params: idParam, body: updateTaskSchema }),
  asyncHandler(ctrl.updateTask)
);
router.patch(
  "/:id/status",
  validate({ params: idParam, body: updateStatusSchema }),
  asyncHandler(ctrl.updateTaskStatus)
);
// Delivery Fail → spawn a fresh TODO rework task referencing this one.
router.post(
  "/:id/rework",
  validate({ params: idParam, body: reworkSchema }),
  asyncHandler(ctrl.reworkTask)
);

// Reference links
router.post("/:id/links", validate({ body: linkSchema }), asyncHandler(ctrl.addLink));
router.delete("/:taskId/links/:linkId", asyncHandler(ctrl.deleteLink));

// Attachments — legacy URL metadata (kept for backward compatibility).
router.post(
  "/:id/attachments",
  validate({ body: attachmentSchema }),
  asyncHandler(ctrl.addAttachment)
);

// Attachments — Cloudinary signed direct upload.
// Live usage vs. limits for a task.
router.get(
  "/:taskId/attachments/usage",
  validate({ params: taskIdParam }),
  asyncHandler(attachments.getTaskAttachmentUsage)
);
// Request signed upload params (rate-limited per user).
router.post(
  "/:taskId/attachments/signature",
  attachmentLimiter,
  validate({ params: taskIdParam, body: signatureSchema }),
  asyncHandler(attachments.createSignature)
);
// Confirm + persist a finished Cloudinary upload (rate-limited per user).
router.post(
  "/:taskId/attachments/complete",
  attachmentLimiter,
  validate({ params: taskIdParam, body: completeSchema }),
  asyncHandler(attachments.completeUpload)
);
// Delete an attachment (URL or Cloudinary). Handles the remote asset + authz.
router.delete(
  "/:taskId/attachments/:attachmentId",
  attachmentLimiter,
  validate({ params: attachmentParams }),
  asyncHandler(ctrl.deleteAttachment)
);

// Comments — any authenticated user can view/add; author edits/deletes own,
// managers/admins moderate (enforced in the controller).
router.get("/:taskId/comments", asyncHandler(comments.listComments));
router.post(
  "/:taskId/comments",
  validate({ body: createCommentSchema }),
  asyncHandler(comments.createComment)
);
router.patch(
  "/:taskId/comments/:commentId",
  validate({ body: updateCommentSchema }),
  asyncHandler(comments.updateComment)
);
router.delete("/:taskId/comments/:commentId", asyncHandler(comments.deleteComment));

// Checklist / subtasks — managers or the task's assignees (enforced in controller).
router.post(
  "/:taskId/checklist",
  validate({ body: createChecklistItemSchema }),
  asyncHandler(checklist.addChecklistItem)
);
router.patch(
  "/:taskId/checklist/:itemId",
  validate({ body: updateChecklistItemSchema }),
  asyncHandler(checklist.updateChecklistItem)
);
router.delete(
  "/:taskId/checklist/:itemId",
  asyncHandler(checklist.deleteChecklistItem)
);

export default router;
