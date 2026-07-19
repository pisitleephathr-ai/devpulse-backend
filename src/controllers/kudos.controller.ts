import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { notify } from "../lib/notify";
import { isTeamManager } from "../lib/authz";
import { AppError } from "../middleware/error";
import type { CreateKudosInput, KudosQuery } from "../schemas/kudos.schema";

const include = {
  fromUser: { select: userMiniSelect },
  toUser: { select: userMiniSelect },
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/kudos — the team kudos wall (most recent first, paginated) plus a
 * 30-day "most appreciated" leaderboard. Any authenticated user.
 */
export async function listKudos(req: Request, res: Response) {
  const q = req.query as unknown as KudosQuery;
  const limit = q.limit ?? 20;
  const page = q.page ?? 1;

  const since = new Date(Date.now() - 30 * DAY_MS);

  const [kudos, count, recent] = await Promise.all([
    prisma.kudos.findMany({
      include,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.kudos.count(),
    // Received counts over the last 30 days for the leaderboard.
    prisma.kudos.groupBy({
      by: ["toUserId"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const topIds = recent
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, 5)
    .map((r) => r.toUserId);
  const topUsers = topIds.length
    ? await prisma.user.findMany({
        where: { id: { in: topIds } },
        select: userMiniSelect,
      })
    : [];
  const byId = new Map(topUsers.map((u) => [u.id, u]));
  const leaderboard = topIds
    .map((id) => {
      const user = byId.get(id);
      const c = recent.find((r) => r.toUserId === id)?._count._all ?? 0;
      return user ? { user, count: c } : null;
    })
    .filter(Boolean);

  res.json({
    kudos,
    total: count,
    page,
    limit,
    hasMore: page * limit < count,
    leaderboard,
  });
}

export async function createKudos(req: Request, res: Response) {
  const data = req.body as CreateKudosInput;
  if (data.toUserId === req.user!.id)
    throw new AppError(400, "ให้ดาวตัวเองไม่ได้นะ 😄");

  const recipient = await prisma.user.findFirst({
    where: { id: data.toUserId, active: true },
    select: { id: true, name: true },
  });
  if (!recipient) throw new AppError(404, "ไม่พบผู้ใช้ที่จะชื่นชม");

  const kudos = await prisma.kudos.create({
    data: {
      fromUserId: req.user!.id,
      toUserId: recipient.id,
      message: data.message.trim(),
      category: data.category?.trim() || null,
    },
    include,
  });

  await logActivity({
    userId: req.user!.id,
    action: "kudos.create",
    message: `ชื่นชม ${recipient.name}: ${kudos.message.slice(0, 60)}`,
    entityType: "kudos",
    entityId: kudos.id,
  });

  await notify({
    userId: recipient.id,
    type: "kudos",
    title: "คุณได้รับคำชม 🎉",
    message: `${kudos.fromUser.name}: ${kudos.message.slice(0, 120)}`,
    entityType: "kudos",
    entityId: kudos.id,
  });

  res.status(201).json({ kudos });
}

export async function deleteKudos(req: Request, res: Response) {
  const existing = await prisma.kudos.findUnique({
    where: { id: req.params.id },
    select: { fromUserId: true },
  });
  if (!existing) throw new AppError(404, "ไม่พบคำชม");
  // Sender or a team manager may remove.
  if (existing.fromUserId !== req.user!.id && !isTeamManager(req))
    throw new AppError(403, "ไม่มีสิทธิ์ลบคำชมนี้");

  await prisma.kudos.delete({ where: { id: req.params.id } });
  res.status(204).send();
}
