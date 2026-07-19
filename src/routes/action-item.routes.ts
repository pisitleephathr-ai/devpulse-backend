import { Router } from "express";
import * as ctrl from "../controllers/action-item.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import {
  createActionItemSchema,
  updateActionItemSchema,
  actionItemQuerySchema,
} from "../schemas/action-item.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

// Team-wide, like /standup and /reports — any authenticated user may view.
router.get("/", validate({ query: actionItemQuerySchema }), asyncHandler(ctrl.listActionItems));
router.post("/", validate({ body: createActionItemSchema }), asyncHandler(ctrl.createActionItem));
router.patch(
  "/:id",
  validate({ params: idParam, body: updateActionItemSchema }),
  asyncHandler(ctrl.updateActionItem)
);
router.delete("/:id", validate({ params: idParam }), asyncHandler(ctrl.deleteActionItem));

export default router;
