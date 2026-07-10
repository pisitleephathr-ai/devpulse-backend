import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";

const NO_BLOCKER = new Set(["", "ไม่มี", "—", "วันนี้ไม่มี", "-"]);

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export async function summary(_req: Request, res: Response) {
  // Reference "today" = the most recent report date present in the data.
  const latest = await prisma.dailyReport.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const refDate = latest?.date ?? new Date();
  const dayRange = { gte: startOfDay(refDate), lte: endOfDay(refDate) };

  const [
    activeMembers,
    reportsToday,
    pendingLeaves,
    inProgressTasks,
    todaysReports,
    taskGroups,
    projects,
    recentActivity,
    upcomingLeaves,
  ] = await Promise.all([
    prisma.user.count({ where: { active: true } }),
    prisma.dailyReport.count({
      where: { date: dayRange, status: "SUBMITTED" },
    }),
    prisma.leaveRequest.count({ where: { status: "PENDING" } }),
    prisma.task.count({ where: { status: "IN_PROGRESS" } }),
    prisma.dailyReport.findMany({
      where: { date: dayRange },
      select: { blockers: true },
    }),
    prisma.task.groupBy({ by: ["projectId", "status"], _count: { _all: true } }),
    prisma.project.findMany({ select: { id: true, name: true, code: true, color: true } }),
    prisma.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { user: { select: userMiniSelect } },
    }),
    prisma.leaveRequest.findMany({
      where: { status: { in: ["APPROVED", "PENDING"] } },
      orderBy: { startDate: "asc" },
      take: 5,
      include: { user: { select: userMiniSelect } },
    }),
  ]);

  const blockers = todaysReports.filter(
    (r) => !NO_BLOCKER.has(r.blockers.trim())
  ).length;

  // Aggregate task counts per project into done/total.
  const byProject = new Map<string, { done: number; total: number }>();
  for (const g of taskGroups) {
    const acc = byProject.get(g.projectId) ?? { done: 0, total: 0 };
    acc.total += g._count._all;
    if (g.status === "DONE") acc.done += g._count._all;
    byProject.set(g.projectId, acc);
  }
  const projectProgress = projects.map((p) => {
    const c = byProject.get(p.id) ?? { done: 0, total: 0 };
    const percent = c.total ? Math.round((c.done / c.total) * 100) : 0;
    return { ...p, done: c.done, total: c.total, percent };
  });

  res.json({
    stats: {
      reportsToday: { submitted: reportsToday, total: activeMembers },
      pendingLeaves,
      inProgressTasks,
      blockers,
    },
    projectProgress,
    recentActivity,
    upcomingLeaves,
  });
}
