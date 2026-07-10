import { Router } from "express";
import * as ctrl from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/error";
import { loginSchema, registerSchema } from "../schemas/auth.schema";

const router = Router();

router.post("/register", validate({ body: registerSchema }), asyncHandler(ctrl.register));
router.post("/login", validate({ body: loginSchema }), asyncHandler(ctrl.login));
router.get("/me", authenticate, asyncHandler(ctrl.me));

export default router;
