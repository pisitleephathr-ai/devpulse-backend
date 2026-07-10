import rateLimit from "express-rate-limit";

/**
 * Throttle authentication attempts to blunt credential-stuffing / brute force.
 * 20 requests per IP per 15 minutes on the auth endpoints.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ภายหลัง" },
});
