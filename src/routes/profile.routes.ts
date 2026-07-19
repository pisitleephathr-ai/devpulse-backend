import { Router } from "express";
import * as ctrl from "../controllers/profile.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import { passwordLimiter } from "../middleware/rateLimit";
import {
  changePasswordSchema,
  linePrefsSchema,
  updateProfileSchema,
} from "../schemas/profile.schema";

const router = Router();

// All profile routes operate on the authenticated user only.
router.use(authenticate);

router.get("/", asyncHandler(ctrl.getProfile));
router.patch("/", validate({ body: updateProfileSchema }), asyncHandler(ctrl.updateProfile));
router.patch(
  "/password",
  passwordLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(ctrl.changePassword)
);

// Personal LINE account linking + DM preferences (own account only).
router.get("/line", asyncHandler(ctrl.getLineStatus));
router.post("/line/link-code", passwordLimiter, asyncHandler(ctrl.createLineLinkCode));
router.post("/line/test", asyncHandler(ctrl.testLineDm));
router.patch(
  "/line/prefs",
  validate({ body: linePrefsSchema }),
  asyncHandler(ctrl.updateLinePrefs)
);
router.delete("/line", asyncHandler(ctrl.unlinkLine));

export default router;
