import { z } from "zod";

const type = z.enum(["VACATION", "SICK", "PERSONAL", "PARENTAL"]);
const status = z.enum(["PENDING", "APPROVED", "REJECTED"]);
const halfDayPeriod = z.enum(["MORNING", "AFTERNOON"]);

const sameUtcDay = (a: Date, b: Date) =>
  a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

export const createLeaveSchema = z
  .object({
    type,
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    reason: z.string().min(1, "กรุณาระบุเหตุผล"),
    /** managers may file on behalf of another member */
    userId: z.string().min(1).optional(),
    /** MORNING/AFTERNOON = half day; omit for a full-day leave */
    halfDayPeriod: halfDayPeriod.optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "วันที่สิ้นสุดต้องไม่มาก่อนวันที่เริ่ม",
    path: ["endDate"],
  })
  .refine((d) => !d.halfDayPeriod || sameUtcDay(d.startDate, d.endDate), {
    message: "การลาครึ่งวันต้องเป็นวันเดียวกัน",
    path: ["halfDayPeriod"],
  });

export const leaveQuerySchema = z.object({
  userId: z.string().optional(),
  type: type.optional(),
  status: status.optional(),
});

export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
export type LeaveQuery = z.infer<typeof leaveQuerySchema>;
