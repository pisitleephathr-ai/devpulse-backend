import { Router } from "express";
import * as ctrl from "../controllers/search.controller";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";

const router = Router();

// Auth required; RBAC scoping is applied inside the controller.
router.use(authenticate);
router.get("/", asyncHandler(ctrl.search));

export default router;
