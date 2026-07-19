import { z } from "zod";

export const createActionItemSchema = z.object({
  text: z.string().min(1, "กรุณากรอกรายละเอียด").max(500),
  assigneeId: z.string().optional().nullable(),
  // Bangkok calendar day the item is raised on (defaults to today).
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็นวันที่ YYYY-MM-DD").optional(),
  // Optional due date (YYYY-MM-DD).
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็นวันที่ YYYY-MM-DD")
    .optional()
    .nullable(),
});

export const updateActionItemSchema = z.object({
  text: z.string().min(1).max(500).optional(),
  assigneeId: z.string().optional().nullable(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็นวันที่ YYYY-MM-DD")
    .optional()
    .nullable(),
  status: z.enum(["OPEN", "DONE"]).optional(),
});

export const actionItemQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type CreateActionItemInput = z.infer<typeof createActionItemSchema>;
export type UpdateActionItemInput = z.infer<typeof updateActionItemSchema>;
export type ActionItemQuery = z.infer<typeof actionItemQuerySchema>;
