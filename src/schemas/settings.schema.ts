import { z } from "zod";

export const updateSettingsSchema = z
  .object({
    teamName: z.string().min(1),
    reportReminderTime: z.string().min(1),
    timezone: z.string().min(1),
    // comma-separated weekday numbers 0-6
    workingDays: z.string().regex(/^([0-6](,[0-6])*)?$/, "รูปแบบวันทำงานไม่ถูกต้อง"),
    reportDueTime: z.string().min(1),
    requireDailyReportDefault: z.boolean(),
    allowHalfDayLeave: z.boolean(),
    notifyReportReminder: z.boolean(),
    notifyLeaveApproval: z.boolean(),
    notifyTaskDue: z.boolean(),
    // LINE OA notification prefs
    lineNotifyNewTask: z.boolean(),
    lineNotifyStatuses: z.array(
      z.enum(["TODO", "IN_PROGRESS", "REVIEW", "READY_TO_TEST", "DONE"])
    ),
    lineNotifyLeave: z.boolean(),
    lineDailyLeaveSummary: z.boolean(),
    lineDailyLeaveSummaryTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "ต้องเป็นเวลา HH:mm"),
    lineDailyReportSummary: z.boolean(),
    lineDailyReportSummaryTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "ต้องเป็นเวลา HH:mm"),
    // comma-separated menu ids
    menuOrder: z.string(),
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

export const createHolidaySchema = z.object({
  name: z.string().min(1),
  // YYYY-MM-DD (Bangkok calendar day)
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็นวันที่ YYYY-MM-DD"),
  description: z.string().optional(),
  type: z.enum(["COMPANY", "PUBLIC", "SPECIAL"]).optional(),
  isActive: z.boolean().optional(),
});

export const updateHolidaySchema = createHolidaySchema.partial();

export const updateMenuSchema = z.object({
  menu: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        customLabel: z.string().max(60).nullable().optional(),
        order: z.number().int().min(0),
        isVisible: z.boolean(),
      })
    )
    .max(50),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
