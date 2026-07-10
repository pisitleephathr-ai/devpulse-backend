import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(12),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "ต้องเป็นสี HEX เช่น #0f766e"),
  description: z.string().max(500).optional(),
  status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED"]).optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
