import { Router } from "express";
import * as ctrl from "../controllers/user.controller";
import { authenticate } from "../middleware/auth";
import { isAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import { createUserSchema, updateUserSchema } from "../schemas/user.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

// Roster is readable by any authenticated user (assignees, avatars, etc.).
router.get("/", asyncHandler(ctrl.listUsers));
router.get("/:id", validate({ params: idParam }), asyncHandler(ctrl.getUser));

// User management is ADMIN-only.
router.post("/", isAdmin, validate({ body: createUserSchema }), asyncHandler(ctrl.createUser));
router.patch(
  "/:id",
  isAdmin,
  validate({ params: idParam, body: updateUserSchema }),
  asyncHandler(ctrl.updateUser)
);
router.patch("/:id/active", isAdmin, validate({ params: idParam }), asyncHandler(ctrl.toggleActive));
router.delete("/:id", isAdmin, validate({ params: idParam }), asyncHandler(ctrl.deleteUser));

export default router;
