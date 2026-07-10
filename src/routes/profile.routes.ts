import { Router } from "express";
import * as ctrl from "../controllers/profile.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import {
  changePasswordSchema,
  updateProfileSchema,
} from "../schemas/profile.schema";

const router = Router();

// All profile routes operate on the authenticated user only.
router.use(authenticate);

router.get("/", asyncHandler(ctrl.getProfile));
router.patch("/", validate({ body: updateProfileSchema }), asyncHandler(ctrl.updateProfile));
router.patch(
  "/password",
  validate({ body: changePasswordSchema }),
  asyncHandler(ctrl.changePassword)
);

export default router;
