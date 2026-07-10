import { Router } from "express";
import * as ctrl from "../controllers/settings.controller";
import { authenticate } from "../middleware/auth";
import { isManagerOrAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import {
  createLeaveTypeSchema,
  updateLeaveTypeSchema,
  updateSettingsSchema,
} from "../schemas/settings.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

// Settings are manager/admin only (developers/QA/designer cannot access).
// Team / workspace settings
router.get("/", isManagerOrAdmin, asyncHandler(ctrl.getSettings));
router.patch(
  "/",
  isManagerOrAdmin,
  validate({ body: updateSettingsSchema }),
  asyncHandler(ctrl.updateSettings)
);

// Leave-type policies
router.get("/leave-types", asyncHandler(ctrl.listLeaveTypes));
router.post(
  "/leave-types",
  isManagerOrAdmin,
  validate({ body: createLeaveTypeSchema }),
  asyncHandler(ctrl.createLeaveType)
);
router.patch(
  "/leave-types/:id",
  isManagerOrAdmin,
  validate({ params: idParam, body: updateLeaveTypeSchema }),
  asyncHandler(ctrl.updateLeaveType)
);
router.delete(
  "/leave-types/:id",
  isManagerOrAdmin,
  validate({ params: idParam }),
  asyncHandler(ctrl.deleteLeaveType)
);

export default router;
