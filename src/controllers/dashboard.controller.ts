import type { Request, Response } from "express";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";

const NO_BLOCKER = new Set(["", "ไม่มี", "—", "วันนี้ไม่มี", "-", "ไม่มีครับ", "ไม่มีค่ะ"]);

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
function cleanBlocker(s: string) {
  return NO_BLOCKER.has(s.trim()) ? "" : s.trim();
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
    // Only users required to submit a daily report count toward the total.
    prisma.user.count({ where: { active: true, requiresDailyReport: true } }),
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

/**
 * Rich manager-facing insights: task health, report submission status,
 * top blockers, per-person workload, and recently completed tasks.
 * Task due-date math uses the real clock; report "today" uses the most
 * recent report date present in the data (imported reports may be historical).
 */
export async function insights(_req: Request, res: Response) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekEnd = endOfDay(new Date(now.getTime() + 6 * 86_400_000));

  const latest = await prisma.dailyReport.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const refDate = latest?.date ?? now;
  const reportDay = { gte: startOfDay(refDate), lte: endOfDay(refDate) };

  const [
    statusGroups,
    overdue,
    dueToday,
    dueThisWeek,
    activeUsers,
    reportsForDay,
    recentBlockerReports,
    workloadGroups,
    recentlyCompleted,
  ] = await Promise.all([
    prisma.task.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.task.count({
      where: { status: { not: "DONE" }, dueDate: { lt: todayStart } },
    }),
    prisma.task.count({
      where: { status: { not: "DONE" }, dueDate: { gte: todayStart, lte: todayEnd } },
    }),
    prisma.task.count({
      where: { status: { not: "DONE" }, dueDate: { gte: todayStart, lte: weekEnd } },
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, avatarKey: true, requiresDailyReport: true },
      orderBy: { name: "asc" },
    }),
    prisma.dailyReport.findMany({
      where: { date: reportDay },
      select: { authorId: true },
    }),
    prisma.dailyReport.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 20,
      include: {
        author: { select: userMiniSelect },
        project: { select: { name: true, code: true, color: true } },
      },
    }),
    prisma.task.groupBy({
      by: ["assigneeId", "status"],
      _count: { _all: true },
      where: { assigneeId: { not: null } },
    }),
    prisma.task.findMany({
      where: { status: "DONE" },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: {
        assignee: { select: userMiniSelect },
        project: { select: { name: true, code: true, color: true } },
      },
    }),
  ]);

  const countBy = (s: TaskStatus) =>
    statusGroups.find((g) => g.status === s)?._count._all ?? 0;
  const todo = countBy("TODO");
  const inProgress = countBy("IN_PROGRESS");
  const review = countBy("REVIEW");
  const done = countBy("DONE");
  const total = todo + inProgress + review + done;

  // Report submission status for the reference day. Only users required to
  // submit a daily report are counted — exempt users never appear as missing
  // and are excluded from the denominator.
  const requiredReporters = activeUsers.filter((u) => u.requiresDailyReport);
  const submittedIds = new Set(reportsForDay.map((r) => r.authorId));
  const submitted = requiredReporters.filter((u) => submittedIds.has(u.id));
  const missing = requiredReporters.filter((u) => !submittedIds.has(u.id));

  // Top blockers from recent reports (skip "no blocker" placeholders).
  const topBlockers = recentBlockerReports
    .map((r) => ({
      id: r.id,
      text: cleanBlocker(r.blockers),
      author: r.author,
      project: r.project,
      date: r.date,
    }))
    .filter((b) => b.text.length > 0)
    .slice(0, 6);

  // Per-person workload (open = not done).
  const byUser = new Map<
    string,
    { todo: number; inProgress: number; review: number; done: number }
  >();
  for (const g of workloadGroups) {
    if (!g.assigneeId) continue;
    const acc = byUser.get(g.assigneeId) ?? { todo: 0, inProgress: 0, review: 0, done: 0 };
    if (g.status === "TODO") acc.todo += g._count._all;
    else if (g.status === "IN_PROGRESS") acc.inProgress += g._count._all;
    else if (g.status === "REVIEW") acc.review += g._count._all;
    else if (g.status === "DONE") acc.done += g._count._all;
    byUser.set(g.assigneeId, acc);
  }
  const workload = activeUsers
    .map((u) => {
      const c = byUser.get(u.id) ?? { todo: 0, inProgress: 0, review: 0, done: 0 };
      const open = c.todo + c.inProgress + c.review;
      return { ...u, ...c, open, total: open + c.done };
    })
    .sort((a, b) => b.inProgress - a.inProgress || b.open - a.open);

  res.json({
    tasks: {
      total,
      todo,
      inProgress,
      review,
      done,
      overdue,
      dueToday,
      dueThisWeek,
      completionRate: total ? Math.round((done / total) * 100) : 0,
    },
    reports: {
      date: refDate,
      submittedCount: submitted.length,
      totalMembers: requiredReporters.length,
      submitted,
      missing,
    },
    topBlockers,
    workload,
    recentlyCompleted: recentlyCompleted.map((t) => ({
      id: t.id,
      title: t.title,
      assignee: t.assignee,
      project: t.project,
      updatedAt: t.updatedAt,
    })),
  });
}
