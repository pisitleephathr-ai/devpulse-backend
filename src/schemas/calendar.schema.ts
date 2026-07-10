import { z } from "zod";

const type = z.enum(["LEAVE", "DEADLINE"]);

export const calendarQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export const createEventSchema = z
  .object({
    title: z.string().min(1),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    type,
  })
  .refine((d) => !d.endDate || d.endDate >= d.startDate, {
    message: "วันที่สิ้นสุดต้องไม่มาก่อนวันที่เริ่ม",
    path: ["endDate"],
  });

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
