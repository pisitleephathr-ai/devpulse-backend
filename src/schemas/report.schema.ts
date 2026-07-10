import { z } from "zod";

const status = z.enum(["SUBMITTED", "DRAFT", "LATE"]);

export const createReportSchema = z.object({
  projectId: z.string().min(1),
  date: z.coerce.date().optional(),
  summary: z.string().optional(),
  did: z.string().min(1, "กรุณากรอกสิ่งที่ทำวันนี้"),
  blockers: z.string().optional(),
  plan: z.string().optional(),
  status: status.optional(),
  /** managers may file a report on behalf of another member */
  authorId: z.string().min(1).optional(),
});

export const updateReportSchema = z
  .object({
    projectId: z.string().min(1),
    date: z.coerce.date(),
    summary: z.string(),
    did: z.string().min(1),
    blockers: z.string(),
    plan: z.string(),
    status,
  })
  .partial();

export const reportQuerySchema = z.object({
  authorId: z.string().optional(),
  projectId: z.string().optional(),
  status: status.optional(),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateReportInput = z.infer<typeof updateReportSchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
