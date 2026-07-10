import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";

export async function listActivity(req: Request, res: Response) {
  const take = Math.min(Number(req.query.limit) || 20, 100);
  const activity = await prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { user: { select: userMiniSelect } },
  });
  res.json({ activity });
}
