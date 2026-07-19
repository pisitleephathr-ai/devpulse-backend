import type { Request, Response } from "express";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import {
  getBangkokDateString,
  bangkokDateToUtcRange,
  startOfBangkokDayUtc,
} from "../lib/date";
import { workdayInfo } from "../lib/workday";
import { onLeaveUserIds } from "../lib/leave-status";

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

// Bangkok date helpers come from src/lib/date.ts (single source of truth).
const bangkokToday = getBangkokDateString;
const bangkokDayRange = bangkokDateToUtcRange;

export async function summary(_req: Request, res: Response) {
  // "Today" = the current Asia/Bangkok day, consistent with /standup and /reports.
  const dayRange = bangkokDayRange(bangkokToday());

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
    // The dashboard feed shows only core team-work activity: the task board
    // (task.*), daily reports (report.*), and APPROVED leave requests. Everything
    // else (projects, comments, pending/rejected leaves, and the sensitive
    // user.*/role.* admin events) stays on the dedicated Activity audit page.
    prisma.activityLog.findMany({
      where: {
        OR: [
          { action: { startsWith: "task." } },
          { action: { startsWith: "report." } },
          { action: { in: ["leave.approve", "leave.approved"] } },
        ],
        // Deleting a board attachment is routine housekeeping — keep it out of
        // the shared feed (uploads still show).
        NOT: [{ action: "task.attachment.delete" }],
      },
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
 * Report "today" uses the current Asia/Bangkok day, consistent with /standup
 * and /reports so the report-status numbers always match those pages.
 */
export async function insights(_req: Request, res: Response) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekEnd = endOfDay(new Date(now.getTime() + 6 * 86_400_000));

  const today = bangkokToday();
  const reportDay = bangkokDayRange(today);

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
      select: {
        id: true,
        name: true,
        avatarKey: true,
        requiresDailyReport: true,
        roleRef: { select: { assignable: true } },
      },
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
    // Workload counts each assigned user once per task (multi-assignee aware).
    prisma.taskAssignee.findMany({
      select: { userId: true, task: { select: { status: true } } },
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
  const readyToTest = countBy("READY_TO_TEST");
  const done = countBy("DONE");
  const total = todo + inProgress + review + readyToTest + done;

  // Report submission status for the reference day. Only users required to
  // submit a daily report are counted — exempt users never appear as missing
  // and are excluded from the denominator.
  const requiredReporters = activeUsers.filter((u) => u.requiresDailyReport);
  const submittedIds = new Set(reportsForDay.map((r) => r.authorId));
  const submitted = requiredReporters.filter((u) => submittedIds.has(u.id));
  // On a non-working day (weekend / company holiday) no daily report is
  // expected — nobody is counted as missing, and the UI shows a holiday state.
  const { isWorkingDay, holiday } = await workdayInfo(today);
  // People on APPROVED leave today aren't expected to report — exclude them from
  // "missing" and flag them as on-leave in the workload.
  const onLeave = await onLeaveUserIds(today);
  const missing = isWorkingDay
    ? requiredReporters.filter((u) => !submittedIds.has(u.id) && !onLeave.has(u.id))
    : [];
  const onLeaveMembers = requiredReporters.filter(
    (u) => onLeave.has(u.id) && !submittedIds.has(u.id)
  );

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
    { todo: number; inProgress: number; review: number; readyToTest: number; done: number }
  >();
  for (const g of workloadGroups) {
    const acc =
      byUser.get(g.userId) ??
      { todo: 0, inProgress: 0, review: 0, readyToTest: 0, done: 0 };
    if (g.task.status === "TODO") acc.todo += 1;
    else if (g.task.status === "IN_PROGRESS") acc.inProgress += 1;
    else if (g.task.status === "REVIEW") acc.review += 1;
    else if (g.task.status === "READY_TO_TEST") acc.readyToTest += 1;
    else if (g.task.status === "DONE") acc.done += 1;
    byUser.set(g.userId, acc);
  }
  // Only roles flagged assignable show on the board. Non-assignable roles
  // (e.g. system admins) are hidden — but still shown if they actually hold
  // tasks, so no real work is ever hidden from managers.
  const hasTasks = new Set(workloadGroups.map((g) => g.userId));
  const workload = activeUsers
    .filter((u) => (u.roleRef?.assignable ?? true) || hasTasks.has(u.id))
    .map((u) => {
      const c =
        byUser.get(u.id) ??
        { todo: 0, inProgress: 0, review: 0, readyToTest: 0, done: 0 };
      const open = c.todo + c.inProgress + c.review + c.readyToTest;
      return {
        id: u.id,
        name: u.name,
        avatarKey: u.avatarKey,
        requiresDailyReport: u.requiresDailyReport,
        onLeave: onLeave.has(u.id),
        ...c,
        open,
        total: open + c.done,
      };
    })
    .sort((a, b) => b.inProgress - a.inProgress || b.open - a.open);

  res.json({
    tasks: {
      total,
      todo,
      inProgress,
      review,
      readyToTest,
      done,
      overdue,
      dueToday,
      dueThisWeek,
      completionRate: total ? Math.round((done / total) * 100) : 0,
    },
    reports: {
      date: today,
      submittedCount: submitted.length,
      totalMembers: requiredReporters.length,
      submitted,
      missing,
      onLeave: onLeaveMembers,
      isWorkingDay,
      holiday,
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

/**
 * GET /api/dashboard/report-trend?days=14 — distinct daily-report submitters per
 * Bangkok day for the last N days, plus the current number of required
 * reporters, for a submission-rate trend chart.
 */
export async function reportTrend(req: Request, res: Response) {
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  // Anchor at 00:00 Bangkok today, then walk back N-1 Bangkok days.
  const todayAnchor = startOfBangkokDayUtc(getBangkokDateString());
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(todayAnchor.getTime() - (days - 1) * dayMs);

  const [rows, required] = await Promise.all([
    prisma.dailyReport.findMany({
      where: { date: { gte: start } },
      select: { authorId: true, date: true },
    }),
    prisma.user.count({ where: { active: true, requiresDailyReport: true } }),
  ]);

  // Bucket by the report's Bangkok day (not its UTC day).
  const byDay = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = getBangkokDateString(r.date);
    let set = byDay.get(key);
    if (!set) {
      set = new Set();
      byDay.set(key, set);
    }
    set.add(r.authorId);
  }

  const series: { date: string; submitted: number }[] = [];
  for (let i = 0; i < days; i++) {
    const key = getBangkokDateString(new Date(start.getTime() + i * dayMs));
    series.push({ date: key, submitted: byDay.get(key)?.size ?? 0 });
  }

  res.json({ days, required, series });
}
