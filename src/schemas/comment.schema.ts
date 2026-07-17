import { z } from "zod";

export const createCommentSchema = z.object({
  message: z.string().trim().min(1, "กรุณาพิมพ์ความคิดเห็น").max(2000),
  /** user ids @mentioned in the message — each is notified */
  mentionedUserIds: z.array(z.string()).max(20).optional(),
});

export const updateCommentSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
