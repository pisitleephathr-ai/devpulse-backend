import { z } from "zod";

// registerSchema removed with the public /register route — see auth.routes.ts.
// User creation is admin-only via user.schema.ts / POST /api/users.

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Request a password-reset link. Email is normalized (trim + lowercase)
 *  BEFORE the email check, so surrounding spaces/caps don't fail validation. */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

/** Set a new password using the token from the reset email. */
export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "ลิงก์ตั้งรหัสผ่านไม่ถูกต้อง"),
    newPassword: z.string().min(8, "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร"),
    confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่านใหม่"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "รหัสผ่านยืนยันไม่ตรงกัน",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
