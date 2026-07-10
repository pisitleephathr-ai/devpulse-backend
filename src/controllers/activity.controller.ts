import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";

/**
 * List activity-log entries, newest first, with optional filters.
 * Query: search, userId, action, entityType, dateFrom, dateTo, limit.
 * Managers/admins only (enforced at the route).
 */
export async function listActivity(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>;
  const take = Math.min(Number(q.limit) || 50, 200);

  const createdAt: Prisma.DateTimeFilter = {};
  if (q.dateFrom) createdAt.gte = new Date(q.dateFrom);
  if (q.dateTo) {
    const to = new Date(q.dateTo);
    to.setHours(23, 59, 59, 999);
    createdAt.lte = to;
  }

  const where: Prisma.ActivityLogWhereInput = {
    userId: q.userId || undefined,
    action: q.action || undefined,
    entityType: q.entityType || undefined,
    ...(q.dateFrom || q.dateTo ? { createdAt } : {}),
    ...(q.search
      ? {
          OR: [
            { message: { contains: q.search, mode: "insensitive" } },
            { action: { contains: q.search, mode: "insensitive" } },
            { user: { name: { contains: q.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const activity = await prisma.activityLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: { user: { select: userMiniSelect } },
  });
  res.json({ activity });
}

/** Distinct action keys present in the log — powers the action filter dropdown. */
export async function activityActions(_req: Request, res: Response) {
  const rows = await prisma.activityLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  res.json({ actions: rows.map((r) => r.action) });
}
