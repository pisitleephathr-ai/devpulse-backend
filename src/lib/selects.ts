import type { Prisma } from "@prisma/client";

/** User fields safe to return in API responses (never the password hash). */
export const userPublicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatarKey: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/** Compact user shape for embedding in reports/tasks/leaves. */
export const userMiniSelect = {
  id: true,
  name: true,
  avatarKey: true,
  role: true,
} satisfies Prisma.UserSelect;
