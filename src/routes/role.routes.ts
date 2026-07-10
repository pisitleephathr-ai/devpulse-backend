import { Router } from "express";
import * as ctrl from "../controllers/role.controller";
import { authenticate } from "../middleware/auth";
import { isAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import { createRoleSchema, updateRoleSchema } from "../schemas/role.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

// Any authenticated user may read roles (needed for dropdowns / display).
router.get("/", asyncHandler(ctrl.listRoles));
router.get("/:id", validate({ params: idParam }), asyncHandler(ctrl.getRole));

// Only ADMIN may mutate roles.
router.post("/", isAdmin, validate({ body: createRoleSchema }), asyncHandler(ctrl.createRole));
router.patch(
  "/:id",
  isAdmin,
  validate({ params: idParam, body: updateRoleSchema }),
  asyncHandler(ctrl.updateRole)
);
router.delete("/:id", isAdmin, validate({ params: idParam }), asyncHandler(ctrl.deleteRole));

export default router;
