import { Router } from "express";
import * as ctrl from "../controllers/notification.controller";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";
import { validate } from "../middleware/validate";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(ctrl.listNotifications));
router.get("/unread-count", asyncHandler(ctrl.unreadCount));
router.patch("/read-all", asyncHandler(ctrl.markAllRead));
router.patch("/:id/read", validate({ params: idParam }), asyncHandler(ctrl.markRead));

export default router;
