import { z } from "zod";

// registerSchema removed with the public /register route — see auth.routes.ts.
// User creation is admin-only via user.schema.ts / POST /api/users.

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
