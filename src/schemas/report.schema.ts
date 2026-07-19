import { z } from "zod";

const status = z.enum(["SUBMITTED", "DRAFT", "LATE"]);

/** One report line: a piece of work + how far it got today + an optional note. */
const reportItem = z.object({
  /** "DID" = งานที่ทำล่าสุด, "PLAN" = แผนงานวันนี้ */
  section: z.enum(["DID", "PLAN"]).default("DID"),
  /** optional link to a board task */
  taskId: z.string().min(1).nullish(),
  title: z.string().min(1, "กรุณากรอกชื่องาน").max(300),
  progress: z.coerce.number().int().min(0).max(100).default(0),
  note: z.string().max(1000).optional(),
});

export const createReportSchema = z
  .object({
    projectId: z.string().min(1),
    date: z.coerce.date().optional(),
    summary: z.string().optional(),
    /** legacy free-text; optional now — content comes from `items` */
    did: z.string().optional(),
    blockers: z.string().optional(),
    plan: z.string().optional(),
    status: status.optional(),
    /** managers may file a report on behalf of another member */
    authorId: z.string().min(1).optional(),
    /** optional board tasks this report references (never required) */
    relatedTaskIds: z.array(z.string().min(1)).optional(),
    /** the per-task work items (the primary content) */
    items: z.array(reportItem).max(40).optional(),
  })
  .refine(
    (d) => (d.items && d.items.length > 0) || (d.did && d.did.trim().length > 0),
    { message: "กรุณาเพิ่มงานอย่างน้อย 1 รายการ", path: ["items"] }
  );

export const updateReportSchema = z
  .object({
    projectId: z.string().min(1),
    date: z.coerce.date(),
    summary: z.string(),
    did: z.string().min(1),
    blockers: z.string(),
    plan: z.string(),
    status,
    /** when provided, replaces the full set of linked tasks (empty clears) */
    relatedTaskIds: z.array(z.string().min(1)),
    /** when provided, replaces the full set of items */
    items: z.array(reportItem).max(40),
  })
  .partial();

export type ReportItemInput = z.infer<typeof reportItem>;

export const reportQuerySchema = z.object({
  authorId: z.string().optional(),
  projectId: z.string().optional(),
  status: status.optional(),
  /** pagination — when `limit` is set the response includes total/page/hasMore.
   *  Omit both for the full (unpaginated) list (backward compatible). */
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateReportInput = z.infer<typeof updateReportSchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
