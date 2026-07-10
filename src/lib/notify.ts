import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

type Client = PrismaClient | Prisma.TransactionClient;

type NotifyInput = {
  userId: string;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
};

/**
 * Create an in-app notification for a user. Never notifies the actor about
 * their own action (callers pass the recipient's id). Best-effort: failures
 * are swallowed so a notification error can never break the main mutation.
 */
export async function notify(input: NotifyInput, client: Client = prisma) {
  try {
    await client.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
  } catch {
    /* non-fatal — notifications are a convenience, not a source of truth */
  }
}

/** Notify several recipients at once (de-duplicated, skips falsy ids). */
export async function notifyMany(
  userIds: (string | null | undefined)[],
  input: Omit<NotifyInput, "userId">,
  client: Client = prisma
) {
  const unique = [...new Set(userIds.filter((id): id is string => !!id))];
  await Promise.all(unique.map((userId) => notify({ ...input, userId }, client)));
}
