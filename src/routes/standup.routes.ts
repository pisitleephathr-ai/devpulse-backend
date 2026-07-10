import { Router } from "express";
import * as ctrl from "../controllers/standup.controller";
import { authenticate } from "../middleware/auth";
import { isManagerOrAdmin } from "../middleware/authorize";
import { asyncHandler } from "../middleware/error";

const router = Router();

router.use(authenticate);

// Team standup summary — any authenticated user (team-wide, like /reports).
router.get("/", asyncHandler(ctrl.standup));
// Reminder to missing reporters — manager/admin only.
router.post("/remind", isManagerOrAdmin, asyncHandler(ctrl.remind));

export default router;
