import { Router } from "express";
import * as dashboard from "../controllers/dashboard.controller";
import * as activity from "../controllers/activity.controller";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";

const router = Router();

router.use(authenticate);

router.get("/summary", asyncHandler(dashboard.summary));
router.get("/insights", asyncHandler(dashboard.insights));
router.get("/report-trend", asyncHandler(dashboard.reportTrend));
router.get("/velocity", asyncHandler(dashboard.velocity));
router.get("/flow", asyncHandler(dashboard.flow));
router.get("/activity", asyncHandler(activity.listActivity));

export default router;
