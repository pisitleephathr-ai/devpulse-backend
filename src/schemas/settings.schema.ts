import { z } from "zod";

export const updateSettingsSchema = z
  .object({
    teamName: z.string().min(1),
    reportReminderTime: z.string().min(1),
  })
  .partial();

export const createLeaveTypeSchema = z.object({
  name: z.string().min(1),
  daysLabel: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "ต้องเป็นสี HEX เช่น #0d9488"),
  autoApprove: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const updateLeaveTypeSchema = createLeaveTypeSchema.partial();

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;
