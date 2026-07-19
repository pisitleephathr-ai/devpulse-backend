import { z } from "zod";

export const createKudosSchema = z.object({
  toUserId: z.string().min(1),
  message: z.string().min(1, "กรุณาเขียนคำชม").max(300),
  category: z.string().max(40).optional().nullable(),
});

export const kudosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export type CreateKudosInput = z.infer<typeof createKudosSchema>;
export type KudosQuery = z.infer<typeof kudosQuerySchema>;
