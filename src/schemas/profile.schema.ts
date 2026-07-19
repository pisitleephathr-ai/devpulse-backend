import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  avatarKey: z.string().min(1).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "กรุณากรอกรหัสผ่านปัจจุบัน"),
    newPassword: z.string().min(8, "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร"),
    confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่านใหม่"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "รหัสผ่านยืนยันไม่ตรงกัน",
    path: ["confirmPassword"],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม",
    path: ["newPassword"],
  });

/** Per-user personal-LINE notification preferences (all optional/partial). */
export const linePrefsSchema = z
  .object({
    taskAssigned: z.boolean().optional(),
    taskStatus: z.boolean().optional(),
    mention: z.boolean().optional(),
    leaveDecision: z.boolean().optional(),
    leaveRequest: z.boolean().optional(),
    reportReminder: z.boolean().optional(),
    dailyDigest: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "ต้องระบุการตั้งค่าอย่างน้อยหนึ่งรายการ",
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type LinePrefsInput = z.infer<typeof linePrefsSchema>;
