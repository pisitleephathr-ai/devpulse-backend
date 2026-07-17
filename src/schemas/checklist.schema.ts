import { z } from "zod";

export const createChecklistItemSchema = z.object({
  text: z.string().trim().min(1, "กรุณากรอกรายการ").max(500),
});

export const updateChecklistItemSchema = z
  .object({
    text: z.string().trim().min(1).max(500).optional(),
    done: z.boolean().optional(),
  })
  .refine((v) => v.text !== undefined || v.done !== undefined, {
    message: "ไม่มีข้อมูลที่จะแก้ไข",
  });

export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;
