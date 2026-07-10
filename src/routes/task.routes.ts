import { Router } from "express";
import * as ctrl from "../controllers/task.controller";
import { authenticate } from "../middleware/auth";
import { isManagerOrAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import {
  createTaskSchema,
  taskQuerySchema,
  updateStatusSchema,
  updateTaskSchema,
} from "../schemas/task.schema";
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

export default router;
