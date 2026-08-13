import { Router } from "express";
import * as ctrl from "../controllers/leave.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import { createLeaveSchema, leaveQuerySchema } from "../schemas/leave.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

router.get("/", validate({ query: leaveQuerySchema }), asyncHandler(ctrl.listLeaves));
router.get("/:id", validate({ params: idParam }), asyncHandler(ctrl.getLeave));
router.post("/", validate({ body: createLeaveSchema }), asyncHandler(ctrl.createLeave));

// Self-cancel a busy declaration (owner-only, before the start date — enforced
// in the controller).
router.patch("/:id/cancel", validate({ params: idParam }), asyncHandler(ctrl.cancelLeave));

// Hard-remove — managers/admins only (cleanup); authorization in the controller.
router.delete("/:id", validate({ params: idParam }), asyncHandler(ctrl.deleteLeave));

export default router;
