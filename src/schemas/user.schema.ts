import { z } from "zod";

export const createUserSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    roleId: z.string().min(1).optional(),
    roleCode: z.string().min(1).optional(),
    avatarKey: z.string().min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => d.roleId || d.roleCode, {
    message: "ต้องระบุ roleId หรือ roleCode",
    path: ["roleId"],
  });

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  roleId: z.string().min(1).optional(),
  roleCode: z.string().min(1).optional(),
  avatarKey: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
