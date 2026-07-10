import { Router } from "express";
import * as ctrl from "../controllers/project.controller";
import { authenticate } from "../middleware/auth";
import { authorize, isManagerOrAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import {
  createProjectSchema,
  updateProjectSchema,
} from "../schemas/project.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.listProjects));
router.get("/:id", validate({ params: idParam }), asyncHandler(ctrl.getProject));

router.post(
  "/",
  isManagerOrAdmin,
  validate({ body: createProjectSchema }),
  asyncHandler(ctrl.createProject)
);
router.patch(
  "/:id",
  isManagerOrAdmin,
  validate({ params: idParam, body: updateProjectSchema }),
  asyncHandler(ctrl.updateProject)
);
router.patch(
  "/:id/archive",
  isManagerOrAdmin,
  validate({ params: idParam }),
  asyncHandler(ctrl.archiveProject)
);
router.patch(
  "/:id/restore",
  isManagerOrAdmin,
  validate({ params: idParam }),
  asyncHandler(ctrl.restoreProject)
);
router.delete(
  "/:id",
  authorize("ADMIN"),
  validate({ params: idParam }),
  asyncHandler(ctrl.deleteProject)
);

export default router;
