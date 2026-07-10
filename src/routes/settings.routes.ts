import { Router } from "express";
import * as ctrl from "../controllers/settings.controller";
import { authenticate } from "../middleware/auth";
import { isAdmin, isManagerOrAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import {
  createHolidaySchema,
  createLeaveTypeSchema,
  updateHolidaySchema,
  updateLeaveTypeSchema,
  updateMenuSchema,
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

// Company holidays — read by any authed user (calendar), managed by manager/admin
router.get("/holidays", asyncHandler(ctrl.listHolidays));
router.post(
  "/holidays",
  isManagerOrAdmin,
  validate({ body: createHolidaySchema }),
  asyncHandler(ctrl.createHoliday)
);
router.patch(
  "/holidays/:id",
  isManagerOrAdmin,
  validate({ params: idParam, body: updateHolidaySchema }),
  asyncHandler(ctrl.updateHoliday)
);
router.delete(
  "/holidays/:id",
  isManagerOrAdmin,
  validate({ params: idParam }),
  asyncHandler(ctrl.deleteHoliday)
);

// Sidebar menu customization — read by any authed user (sidebar); admin-only writes
router.get("/menu", asyncHandler(ctrl.getMenu));
router.patch("/menu", isAdmin, validate({ body: updateMenuSchema }), asyncHandler(ctrl.updateMenu));
router.post("/menu/reset", isAdmin, asyncHandler(ctrl.resetMenu));

export default router;
