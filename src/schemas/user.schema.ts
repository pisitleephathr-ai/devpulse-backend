import { z } from "zod";

const role = z.enum(["MANAGER", "ADMIN", "DEVELOPER", "QA"]);

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: role.optional(),
  avatarKey: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export const updateUserSchema = z
  .object({
    name: z.string().min(1),
    role: role,
    avatarKey: z.string().min(1),
    active: z.boolean(),
  })
  .partial();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
