import { Router } from "express";
import * as ctrl from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import { authLimiter } from "../middleware/rateLimit";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from "../schemas/auth.schema";

const router = Router();

// No public /register — accounts are provisioned by admins via POST /api/users.
router.post("/login", authLimiter, validate({ body: loginSchema }), asyncHandler(ctrl.login));
// Public password reset. authLimiter (20/IP/15min) blunts abuse: forgot-password
// as an email/enumeration probe, reset-password as token brute force.
router.post(
  "/forgot-password",
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(ctrl.forgotPassword)
);
router.post(
  "/reset-password",
  authLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(ctrl.resetPassword)
);
router.get("/me", authenticate, asyncHandler(ctrl.me));

export default router;
