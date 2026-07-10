import { Router } from "express";
import * as ctrl from "../controllers/user.controller";
import { authenticate } from "../middleware/auth";
import { authorize, isManagerOrAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import { createUserSchema, updateUserSchema } from "../schemas/user.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.listUsers));
router.get("/:id", validate({ params: idParam }), asyncHandler(ctrl.getUser));

router.post(
  "/",
  isManagerOrAdmin,
  validate({ body: createUserSchema }),
  asyncHandler(ctrl.createUser)
);
router.patch(
  "/:id",
  isManagerOrAdmin,
  validate({ params: idParam, body: updateUserSchema }),
  asyncHandler(ctrl.updateUser)
);
router.patch(
  "/:id/active",
  isManagerOrAdmin,
  validate({ params: idParam }),
  asyncHandler(ctrl.toggleActive)
);
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: idParam }),
  asyncHandler(ctrl.deleteUser)
);

export default router;
