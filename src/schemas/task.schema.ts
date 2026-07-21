import { z } from "zod";

const priority = z.enum(["HIGH", "MEDIUM", "LOW"]);
const status = z.enum([
  "TODO",
  "IN_PROGRESS",
  "DEV_REVIEW",
  "DEV_DONE",
  "DELIVERY_DONE",
  "DELIVERY_FAIL",
]);

export const linkSchema = z.object({
  title: z.string().min(1, "กรุณากรอกชื่อลิงก์"),
  url: z.string().url("URL ไม่ถูกต้อง"),
});

export const attachmentSchema = z.object({
  fileName: z.string().min(1, "กรุณากรอกชื่อไฟล์"),
  fileUrl: z.string().url("URL ไฟล์ไม่ถูกต้อง"),
  fileType: z.string().optional(),
  fileSize: z.number().int().nonnegative().optional(),
});

export const createTaskSchema = z.object({
  title: z.string().min(1, "กรุณากรอกชื่องาน"),
  projectId: z.string().min(1),
  assigneeId: z.string().min(1).nullable().optional(),
  /** preferred: full set of assignees */
  assigneeIds: z.array(z.string().min(1)).optional(),
  /** the tester/QA the card is handed to after DEV_DONE */
  handoffUserId: z.string().min(1).nullable().optional(),
  priority: priority.optional(),
  status: status.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  /** planning estimate, date + time */
  estimatedFinishAt: z.coerce.date().nullable().optional(),
  description: z.string().optional(),
  links: z.array(linkSchema).optional(),
  attachments: z.array(attachmentSchema).optional(),
});

// NOTE: `status` is intentionally NOT editable here — status changes must go
// through PATCH /:id/status so every transition is validated and logged as
// `task.status` (velocity/aging metrics read only those activity rows).
export const updateTaskSchema = z
  .object({
    title: z.string().min(1),
    projectId: z.string().min(1),
    assigneeId: z.string().min(1).nullable(),
    assigneeIds: z.array(z.string().min(1)),
    handoffUserId: z.string().min(1).nullable(),
    priority,
    dueDate: z.coerce.date().nullable(),
    estimatedFinishAt: z.coerce.date().nullable(),
    description: z.string(),
    links: z.array(linkSchema),
    attachments: z.array(attachmentSchema),
  })
  .partial();

export const updateStatusSchema = z.object({ status });

/** Create a rework (retry) task from a DELIVERY_FAIL card. */
export const reworkSchema = z.object({
  comment: z.string().min(1, "กรุณาระบุเหตุผลที่ไม่ผ่าน"),
});

export const taskQuerySchema = z.object({
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
  status: status.optional(),
  priority: priority.optional(),
  search: z.string().optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ReworkInput = z.infer<typeof reworkSchema>;
export type TaskQuery = z.infer<typeof taskQuerySchema>;
export type LinkInput = z.infer<typeof linkSchema>;
export type AttachmentInput = z.infer<typeof attachmentSchema>;
