import { Router } from "express";
import {
  cronLineSummaries,
  cronAttachmentCleanup,
  cronSetupRichMenu,
} from "../controllers/cron.controller";
import { asyncHandler } from "../middleware/error";

const router = Router();

// GET and POST both accepted so any cron service (many only do GET) can call it.
router.get("/line-summaries", asyncHandler(cronLineSummaries));
router.post("/line-summaries", asyncHandler(cronLineSummaries));

router.get("/attachment-cleanup", asyncHandler(cronAttachmentCleanup));
router.post("/attachment-cleanup", asyncHandler(cronAttachmentCleanup));

// One-off trigger to (re)publish the LINE rich menu from inside the deploy.
router.get("/line-richmenu", asyncHandler(cronSetupRichMenu));
router.post("/line-richmenu", asyncHandler(cronSetupRichMenu));

export default router;
