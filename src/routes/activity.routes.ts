import { Router } from "express";
import * as activity from "../controllers/activity.controller";
import { authenticate } from "../middleware/auth";
import { isManagerOrAdmin } from "../middleware/authorize";
import { asyncHandler } from "../middleware/error";

const router = Router();

// The full audit log is manager/admin only.
router.use(authenticate, isManagerOrAdmin);

router.get("/", asyncHandler(activity.listActivity));
router.get("/actions", asyncHandler(activity.activityActions));

export default router;
