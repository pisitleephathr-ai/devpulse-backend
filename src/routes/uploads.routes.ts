import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { isManagerOrAdmin } from "../middleware/authorize";
import { asyncHandler } from "../middleware/error";
import {
  getUploadConfig,
  getCreditUsage,
} from "../controllers/attachment.controller";

const router = Router();

router.use(authenticate);

// Upload limits + allowlists (source of truth the frontend reads at startup).
router.get("/config", asyncHandler(getUploadConfig));

// Cloudinary account usage (credits/storage) for the Settings panel — manager/admin.
router.get("/credit-usage", isManagerOrAdmin, asyncHandler(getCreditUsage));

export default router;
