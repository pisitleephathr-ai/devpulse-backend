import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

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

/**
 * Throttle the attachment mutation endpoints (signature / complete / delete).
 * Keyed by authenticated user id (falling back to IP for safety) so one user's
 * activity can't exhaust the whole team's budget, and so a shared office IP
 * isn't collectively throttled. 30 requests per user per 10 minutes — well above
 * a real burst of "select 5 files, upload, retry one" but a hard cap on abuse.
 * Mounted AFTER `authenticate`, so req.user is populated.
 */
export const attachmentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip ?? ""),
  message: { error: "อัปโหลด/ลบไฟล์บ่อยเกินไป กรุณาลองใหม่ภายหลัง" },
});
