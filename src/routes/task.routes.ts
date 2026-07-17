import { Router } from "express";
import * as ctrl from "../controllers/task.controller";
import * as comments from "../controllers/comment.controller";
import * as checklist from "../controllers/checklist.controller";
import { authenticate } from "../middleware/auth";
import { isManagerOrAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import {
  attachmentSchema,
  createTaskSchema,
  linkSchema,
  taskQuerySchema,
  updateStatusSchema,
  updateTaskSchema,
} from "../schemas/task.schema";
import { createCommentSchema, updateCommentSchema } from "../schemas/comment.schema";
import {
  createChecklistItemSchema,
  updateChecklistItemSchema,
} from "../schemas/checklist.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

router.get("/", validate({ query: taskQuerySchema }), asyncHandler(ctrl.listTasks));
router.get("/:id", validate({ params: idParam }), asyncHandler(ctrl.getTask));

// Create/delete are manager/admin only.
router.post("/", isManagerOrAdmin, validate({ body: createTaskSchema }), asyncHandler(ctrl.createTask));
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

// Reference links
router.post("/:id/links", validate({ body: linkSchema }), asyncHandler(ctrl.addLink));
router.delete("/:taskId/links/:linkId", asyncHandler(ctrl.deleteLink));

// Attachments (URL-only metadata)
router.post(
  "/:id/attachments",
  validate({ body: attachmentSchema }),
  asyncHandler(ctrl.addAttachment)
);
router.delete("/:taskId/attachments/:attachmentId", asyncHandler(ctrl.deleteAttachment));

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
