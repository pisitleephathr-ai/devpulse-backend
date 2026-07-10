import { z } from "zod";

const type = z.enum(["VACATION", "SICK", "PERSONAL", "PARENTAL"]);
const status = z.enum(["PENDING", "APPROVED", "REJECTED"]);

export const createLeaveSchema = z
  .object({
    type,
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    reason: z.string().min(1, "กรุณาระบุเหตุผล"),
    /** managers may file on behalf of another member */
    userId: z.string().min(1).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "วันที่สิ้นสุดต้องไม่มาก่อนวันที่เริ่ม",
    path: ["endDate"],
  });

export const leaveQuerySchema = z.object({
  userId: z.string().optional(),
  type: type.optional(),
  status: status.optional(),
});

export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
export type LeaveQuery = z.infer<typeof leaveQuerySchema>;
