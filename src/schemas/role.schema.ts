import { z } from "zod";

export const createRoleSchema = z.object({
  name: z.string().min(1),
  code: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[A-Za-z0-9_-]+$/, "code ต้องเป็นตัวอักษร/ตัวเลข/ขีด เท่านั้น"),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
