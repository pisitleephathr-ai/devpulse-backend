import { Router } from "express";
import { cronLineSummaries } from "../controllers/cron.controller";
import { asyncHandler } from "../middleware/error";

const router = Router();

// GET and POST both accepted so any cron service (many only do GET) can call it.
router.get("/line-summaries", asyncHandler(cronLineSummaries));
router.post("/line-summaries", asyncHandler(cronLineSummaries));

export default router;
