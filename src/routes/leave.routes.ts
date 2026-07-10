import { Router } from "express";
import * as ctrl from "../controllers/leave.controller";
import { authenticate } from "../middleware/auth";
import { isManagerOrAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import { createLeaveSchema, leaveQuerySchema } from "../schemas/leave.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

router.get("/", validate({ query: leaveQuerySchema }), asyncHandler(ctrl.listLeaves));
router.get("/:id", validate({ params: idParam }), asyncHandler(ctrl.getLeave));
router.post("/", validate({ body: createLeaveSchema }), asyncHandler(ctrl.createLeave));

router.patch(
  "/:id/approve",
  isManagerOrAdmin,
  validate({ params: idParam }),
  asyncHandler(ctrl.approveLeave)
);
router.patch(
  "/:id/reject",
  isManagerOrAdmin,
  validate({ params: idParam }),
  asyncHandler(ctrl.rejectLeave)
);

export default router;
