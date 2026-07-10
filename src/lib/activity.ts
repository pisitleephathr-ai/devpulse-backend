import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

type Client = PrismaClient | Prisma.TransactionClient;

type LogInput = {
  userId: string;
  action: string;
  message: string;
  entityType?: string;
  entityId?: string;
};

/**
 * Record an activity-log entry for an important action.
 * Accepts a transaction client so it can run inside a transaction.
 */
export function logActivity(input: LogInput, client: Client = prisma) {
  return client.activityLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
    },
  });
}
