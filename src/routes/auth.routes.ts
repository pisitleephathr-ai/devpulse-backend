import { Router } from "express";
import * as ctrl from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import { authLimiter } from "../middleware/rateLimit";
import { loginSchema } from "../schemas/auth.schema";

const router = Router();

// No public /register — accounts are provisioned by admins via POST /api/users.
router.post("/login", authLimiter, validate({ body: loginSchema }), asyncHandler(ctrl.login));
router.get("/me", authenticate, asyncHandler(ctrl.me));

export default router;
