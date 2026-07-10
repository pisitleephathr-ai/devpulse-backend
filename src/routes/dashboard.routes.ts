import { Router } from "express";
import * as dashboard from "../controllers/dashboard.controller";
import * as activity from "../controllers/activity.controller";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";

const router = Router();

router.use(authenticate);

router.get("/summary", asyncHandler(dashboard.summary));
router.get("/activity", asyncHandler(activity.listActivity));

export default router;
