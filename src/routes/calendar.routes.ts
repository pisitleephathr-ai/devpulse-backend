import { Router } from "express";
import * as ctrl from "../controllers/calendar.controller";
import { authenticate } from "../middleware/auth";
import { isManagerOrAdmin } from "../middleware/authorize";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import {
  calendarQuerySchema,
  createEventSchema,
} from "../schemas/calendar.schema";
import { idParam } from "../schemas/common.schema";

const router = Router();

router.use(authenticate);

router.get("/", validate({ query: calendarQuerySchema }), asyncHandler(ctrl.listEvents));
router.post(
  "/",
  isManagerOrAdmin,
  validate({ body: createEventSchema }),
  asyncHandler(ctrl.createEvent)
);
router.delete(
  "/:id",
  isManagerOrAdmin,
  validate({ params: idParam }),
  asyncHandler(ctrl.deleteEvent)
);

export default router;
