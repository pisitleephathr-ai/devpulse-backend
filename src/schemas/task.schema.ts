import { z } from "zod";

const priority = z.enum(["HIGH", "MEDIUM", "LOW"]);
const status = z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]);

export const createTaskSchema = z.object({
  title: z.string().min(1, "กรุณากรอกชื่องาน"),
  projectId: z.string().min(1),
  assigneeId: z.string().min(1).nullable().optional(),
  priority: priority.optional(),
  status: status.optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().min(1),
    projectId: z.string().min(1),
    assigneeId: z.string().min(1).nullable(),
    priority,
    status,
    dueDate: z.coerce.date().nullable(),
  })
  .partial();

export const updateStatusSchema = z.object({ status });

export const taskQuerySchema = z.object({
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
  status: status.optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskQuery = z.infer<typeof taskQuerySchema>;
