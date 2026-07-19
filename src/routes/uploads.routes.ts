import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";
import { getUploadConfig } from "../controllers/attachment.controller";

const router = Router();

router.use(authenticate);

// Upload limits + allowlists (source of truth the frontend reads at startup).
router.get("/config", asyncHandler(getUploadConfig));

export default router;
