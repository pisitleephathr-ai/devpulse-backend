import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyPassword } from "../lib/password";
import { signToken } from "../lib/jwt";
import { userPublicSelect, serializeUser } from "../lib/selects";
import { AppError } from "../middleware/error";
import { appBaseUrl } from "../lib/line";
import {
  isMailerConfigured,
  passwordResetEmailHtml,
  sendMail,
} from "../lib/mailer";
import {
  issueResetToken,
  resetPasswordWithToken,
  RESET_TOKEN_TTL_MS,
} from "../lib/password-reset";
import { logActivity } from "../lib/activity";
import type {
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
} from "../schemas/auth.schema";

/** Message returned for every forgot-password request (no user enumeration). */
const FORGOT_PASSWORD_REPLY =
  "หากอีเมลนี้มีบัญชีอยู่ในระบบ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว กรุณาตรวจสอบกล่องอีเมล";

// Public self-registration was removed: it was unauthenticated yet accepted a
// client-supplied `role`, letting anyone create an ADMIN account (and any
// signup could read all team data). Accounts are created by admins via
// `POST /api/users` (isAdmin-gated). Keep auth to login + me only.

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as LoginInput;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { ...userPublicSelect, password: true },
  });
  if (!user || !(await verifyPassword(password, user.password))) {
    throw new AppError(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง (Invalid credentials)");
  }
  if (!user.active) throw new AppError(403, "บัญชีถูกปิดใช้งาน (Account disabled)");

  const { password: _pw, ...rest } = user;
  const safe = serializeUser(rest);
  const token = signToken({ sub: user.id, role: safe.role?.code ?? "DEVELOPER" });
  res.json({ token, user: safe });
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: userPublicSelect,
  });
  res.json({ user: user ? serializeUser(user) : null });
}

/**
 * POST /api/auth/forgot-password — start a reset. Always replies 200 with the
 * same generic message so an attacker can't learn which emails have accounts.
 * Only active users with a resolvable app URL + configured mailer actually get
 * an email; everything else is a silent no-op behind the same response.
 */
export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body as ForgotPasswordInput;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, active: true },
  });

  const base = appBaseUrl();
  if (user && user.active && base && isMailerConfigured()) {
    const { token } = await issueResetToken(user.id);
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;
    const mail = passwordResetEmailHtml({
      name: user.name,
      resetUrl,
      ttlMinutes: Math.round(RESET_TOKEN_TTL_MS / 60000),
    });
    // Fire-and-forget: don't await the (up-to-8s) send. Awaiting it would both
    // slow the response and widen a timing side-channel for account enumeration.
    // sendMail is best-effort and never throws, but guard anyway.
    void sendMail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text }).catch(
      (err) => console.warn("[auth] reset email send error:", err)
    );
  } else if (user && (!base || !isMailerConfigured())) {
    console.warn(
      "[auth] forgot-password requested but " +
        (!base ? "APP_URL not set" : "mailer not configured") +
        " — no email sent"
    );
  }

  res.json({ message: FORGOT_PASSWORD_REPLY });
}

/**
 * POST /api/auth/reset-password — finish a reset with the emailed token. The
 * token is validated, consumed (single-use), and the new password is set in
 * one transaction. An invalid/expired/used token returns 400 without leaking
 * which of those it was.
 */
export async function resetPassword(req: Request, res: Response) {
  const { token, newPassword } = req.body as ResetPasswordInput;

  const user = await resetPasswordWithToken(token, newPassword);
  if (!user) {
    throw new AppError(
      400,
      "ลิงก์ตั้งรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่อีกครั้ง"
    );
  }

  await logActivity({
    userId: user.id,
    action: "password.reset",
    message: "ตั้งรหัสผ่านใหม่ผ่านลิงก์รีเซ็ต",
    entityType: "user",
    entityId: user.id,
  });

  res.json({ message: "ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่" });
}
