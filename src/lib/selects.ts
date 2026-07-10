import type { Prisma } from "@prisma/client";
import { roleSelect } from "./roles";

/** User fields safe to return; embeds the role object (never the password). */
export const userPublicSelect = {
  id: true,
  name: true,
  email: true,
  avatarKey: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  roleRef: { select: roleSelect },
} satisfies Prisma.UserSelect;

/** Compact user shape for embedding in reports/tasks/leaves. */
export const userMiniSelect = {
  id: true,
  name: true,
  avatarKey: true,
  roleRef: { select: { code: true, name: true } },
} satisfies Prisma.UserSelect;

export type RoleObject = {
  id: string;
  name: string;
  code: string;
  isSystem: boolean;
  isActive: boolean;
} | null;

/** Reshape a userPublicSelect result so `role` is the role object. */
export function serializeUser<T extends { roleRef: RoleObject }>(
  user: T
): Omit<T, "roleRef"> & { role: RoleObject } {
  const { roleRef, ...rest } = user;
  return { ...rest, role: roleRef };
}
