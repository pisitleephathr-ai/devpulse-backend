import { z } from "zod";
import { ALL_PERMISSIONS } from "../lib/roles";

// Allowlist role permissions against the canonical capability set (no arbitrary
// strings) — single source of truth in src/lib/roles.ts.
const permission = z.enum(ALL_PERMISSIONS as [string, ...string[]]);

export const createRoleSchema = z.object({
  name: z.string().min(1),
  code: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[A-Za-z0-9_-]+$/, "code ต้องเป็นตัวอักษร/ตัวเลข/ขีด เท่านั้น"),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  /** capability grants (deduped server-side) */
  permissions: z.array(permission).optional(),
  /** whether the role appears on the task board (assignable + in workload) */
  assignable: z.boolean().optional(),
  /** sidebar menu keys this role may see ([] = inherit code defaults) */
  menuAccess: z.array(z.string().min(1).max(40)).optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(permission).optional(),
  assignable: z.boolean().optional(),
  menuAccess: z.array(z.string().min(1).max(40)).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
