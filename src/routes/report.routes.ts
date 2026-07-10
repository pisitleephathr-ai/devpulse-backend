import { Router } from "express";
import * as ctrl from "../controllers/report.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import {
  createReportSchema,
  reportQuerySchema,
  updateReportSchema,
} from "../schemas/report.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

router.get("/", validate({ query: reportQuerySchema }), asyncHandler(ctrl.listReports));
router.get("/:id", validate({ params: idParam }), asyncHandler(ctrl.getReport));
router.post("/", validate({ body: createReportSchema }), asyncHandler(ctrl.createReport));
router.patch(
  "/:id",
  validate({ params: idParam, body: updateReportSchema }),
  asyncHandler(ctrl.updateReport)
);
router.delete("/:id", validate({ params: idParam }), asyncHandler(ctrl.deleteReport));

export default router;
