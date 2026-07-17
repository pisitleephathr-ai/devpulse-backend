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

/**
 * Throttle password changes (verifies the *current* password, so it's a
 * brute-force surface). 10 attempts per IP per 15 minutes — well above any
 * legitimate use.
 */
export const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "เปลี่ยนรหัสผ่านบ่อยเกินไป กรุณาลองใหม่ภายหลัง" },
});
