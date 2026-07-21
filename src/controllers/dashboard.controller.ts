import type { Request, Response } from "express";
import type { TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import {
  getBangkokDateString,
  bangkokDateToUtcRange,
  startOfBangkokDayUtc,
  getBangkokWeekday,
} from "../lib/date";
import { workdayInfo } from "../lib/workday";
import { onLeaveUserIds } from "../lib/leave-status";
import { onTimeStatsByUser } from "../lib/ontime";

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
    // Archived projects are hidden from the dashboard progress list.
    prisma.project.findMany({
      where: { isArchived: false },
      select: { id: true, name: true, code: true, color: true },
    }),
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
    if (g.status === "DELIVERY_DONE") acc.done += g._count._all;
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
      where: { status: { notIn: ["DELIVERY_DONE", "DELIVERY_FAIL"] }, dueDate: { lt: todayStart } },
    }),
    prisma.task.count({
      where: { status: { notIn: ["DELIVERY_DONE", "DELIVERY_FAIL"] }, dueDate: { gte: todayStart, lte: todayEnd } },
    }),
    prisma.task.count({
      where: { status: { notIn: ["DELIVERY_DONE", "DELIVERY_FAIL"] }, dueDate: { gte: todayStart, lte: weekEnd } },
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
      where: { status: "DELIVERY_DONE" },
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
  const devReview = countBy("DEV_REVIEW");
  const devDone = countBy("DEV_DONE");
  const deliveryDone = countBy("DELIVERY_DONE");
  const deliveryFail = countBy("DELIVERY_FAIL");
  const total = todo + inProgress + devReview + devDone + deliveryDone + deliveryFail;

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
  // Per-person on-time completion stats (DONE tasks with a due date).
  const onTime = await onTimeStatsByUser();
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

  // Per-person workload (open = not yet delivered).
  const byUser = new Map<
    string,
    { todo: number; inProgress: number; devReview: number; devDone: number; deliveryDone: number; deliveryFail: number }
  >();
  for (const g of workloadGroups) {
    const acc =
      byUser.get(g.userId) ??
      { todo: 0, inProgress: 0, devReview: 0, devDone: 0, deliveryDone: 0, deliveryFail: 0 };
    if (g.task.status === "TODO") acc.todo += 1;
    else if (g.task.status === "IN_PROGRESS") acc.inProgress += 1;
    else if (g.task.status === "DEV_REVIEW") acc.devReview += 1;
    else if (g.task.status === "DEV_DONE") acc.devDone += 1;
    else if (g.task.status === "DELIVERY_DONE") acc.deliveryDone += 1;
    else if (g.task.status === "DELIVERY_FAIL") acc.deliveryFail += 1;
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
        { todo: 0, inProgress: 0, devReview: 0, devDone: 0, deliveryDone: 0, deliveryFail: 0 };
      const open = c.todo + c.inProgress + c.devReview + c.devDone;
      const ot = onTime.get(u.id);
      return {
        id: u.id,
        name: u.name,
        avatarKey: u.avatarKey,
        requiresDailyReport: u.requiresDailyReport,
        onLeave: onLeave.has(u.id),
        ...c,
        open,
        total: open + c.deliveryDone + c.deliveryFail,
        // on-time completion (null rate when nothing closed yet with a due date)
        closed: ot?.closed ?? 0,
        onTimeClosed: ot?.onTime ?? 0,
        lateClosed: ot?.late ?? 0,
        onTimeRate: ot && ot.closed > 0 ? ot.rate : null,
      };
    })
    .sort((a, b) => b.inProgress - a.inProgress || b.open - a.open);

  res.json({
    tasks: {
      total,
      todo,
      inProgress,
      devReview,
      devDone,
      deliveryDone,
      deliveryFail,
      overdue,
      dueToday,
      dueThisWeek,
      completionRate: total ? Math.round((deliveryDone / total) * 100) : 0,
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

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * GET /api/dashboard/velocity?weeks=8 — weekly delivery velocity (tasks
 * completed per Bangkok week, Monday-anchored) and average cycle time over the
 * same window. Cycle time = time from a task's first status change (i.e. when
 * work started — moving it out of the initial column) to its completion,
 * falling back to createdAt when a task has no recorded status change.
 */
export async function velocity(req: Request, res: Response) {
  const weeks = Math.min(12, Math.max(1, Number(req.query.weeks) || 8));

  // Monday 00:00 (Bangkok) of the current week, as a UTC instant.
  const todayStartUtc = startOfBangkokDayUtc(getBangkokDateString());
  const sinceMonday = (getBangkokWeekday() + 6) % 7; // Mon→0 … Sun→6
  const currentMondayUtc = new Date(todayStartUtc.getTime() - sinceMonday * DAY_MS);
  const startUtc = new Date(currentMondayUtc.getTime() - (weeks - 1) * WEEK_MS);

  // Tasks completed within the window (velocity + cycle-time population).
  const doneTasks = await prisma.task.findMany({
    where: { status: "DELIVERY_DONE", completedAt: { gte: startUtc } },
    select: { id: true, createdAt: true, completedAt: true },
  });

  // Earliest "task.status" activity per task = when it first left its column.
  const ids = doneTasks.map((t) => t.id);
  const logs = ids.length
    ? await prisma.activityLog.findMany({
        where: { action: "task.status", entityId: { in: ids } },
        select: { entityId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const firstMove = new Map<string, Date>();
  for (const l of logs) {
    if (l.entityId && !firstMove.has(l.entityId)) firstMove.set(l.entityId, l.createdAt);
  }

  // Cycle time (days) per completed task.
  const cycleDays: number[] = [];
  for (const t of doneTasks) {
    if (!t.completedAt) continue;
    const start = firstMove.get(t.id) ?? t.createdAt;
    const ms = t.completedAt.getTime() - start.getTime();
    if (ms >= 0) cycleDays.push(ms / DAY_MS);
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const avgDays = cycleDays.length
    ? round1(cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length)
    : null;
  const sorted = [...cycleDays].sort((a, b) => a - b);
  const medianDays = sorted.length
    ? round1(
        sorted.length % 2
          ? sorted[(sorted.length - 1) / 2]
          : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      )
    : null;

  // Weekly velocity buckets, oldest → newest.
  const series: { weekStart: string; completed: number }[] = [];
  for (let i = 0; i < weeks; i++) {
    const wStart = new Date(startUtc.getTime() + i * WEEK_MS);
    const wEnd = new Date(wStart.getTime() + WEEK_MS);
    const completed = doneTasks.filter(
      (t) => t.completedAt && t.completedAt >= wStart && t.completedAt < wEnd
    ).length;
    series.push({ weekStart: getBangkokDateString(wStart), completed });
  }
  const totalCompleted = series.reduce((s, w) => s + w.completed, 0);

  res.json({
    weeks,
    cycleTime: { avgDays, medianDays, count: cycleDays.length },
    velocity: {
      series,
      avgPerWeek: round1(totalCompleted / weeks),
      total: totalCompleted,
    },
  });
}

/**
 * GET /api/dashboard/flow?weeks=8 — work-flow health:
 *  - aging: how long each OPEN task has sat in its current status (derived from
 *    the latest task.status activity, falling back to createdAt), bucketed, plus
 *    the "stalest" open tasks; and
 *  - flow: intake vs throughput per Bangkok week (tasks created vs completed) —
 *    a practical backlog burn view when there is no sprint concept.
 */
export async function flow(req: Request, res: Response) {
  const weeks = Math.min(12, Math.max(1, Number(req.query.weeks) || 8));
  const now = new Date();

  const todayStartUtc = startOfBangkokDayUtc(getBangkokDateString());
  const sinceMonday = (getBangkokWeekday() + 6) % 7;
  const currentMondayUtc = new Date(todayStartUtc.getTime() - sinceMonday * DAY_MS);
  const startUtc = new Date(currentMondayUtc.getTime() - (weeks - 1) * WEEK_MS);

  const [openTasks, createdRows, completedRows, openNow] = await Promise.all([
    prisma.task.findMany({
      where: { status: { notIn: ["DELIVERY_DONE", "DELIVERY_FAIL"] } },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        project: { select: { code: true, color: true, name: true } },
        assignees: {
          select: { user: { select: { id: true, name: true, avatarKey: true } } },
        },
      },
    }),
    prisma.task.findMany({
      where: { createdAt: { gte: startUtc } },
      select: { createdAt: true },
    }),
    prisma.task.findMany({
      where: { status: "DELIVERY_DONE", completedAt: { gte: startUtc } },
      select: { completedAt: true },
    }),
    prisma.task.count({ where: { status: { notIn: ["DELIVERY_DONE", "DELIVERY_FAIL"] } } }),
  ]);

  // "Entered current status" per open task = its most recent task.status log.
  const openIds = openTasks.map((t) => t.id);
  const logs = openIds.length
    ? await prisma.activityLog.findMany({
        where: { action: "task.status", entityId: { in: openIds } },
        select: { entityId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const enteredAt = new Map<string, Date>();
  for (const l of logs) {
    if (l.entityId && !enteredAt.has(l.entityId)) enteredAt.set(l.entityId, l.createdAt);
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const aged = openTasks.map((t) => {
    const since = enteredAt.get(t.id) ?? t.createdAt;
    const ageDays = Math.max(0, (now.getTime() - since.getTime()) / DAY_MS);
    return { t, ageDays };
  });

  // Age buckets (days in current status).
  const BUCKETS = [
    { key: "d0", label: "< 1 วัน", max: 1 },
    { key: "d1", label: "1–3 วัน", max: 3 },
    { key: "d3", label: "3–7 วัน", max: 7 },
    { key: "d7", label: "7–14 วัน", max: 14 },
    { key: "d14", label: "≥ 14 วัน", max: Infinity },
  ];
  const buckets = BUCKETS.map((b) => ({ key: b.key, label: b.label, count: 0 }));
  for (const a of aged) {
    const i = BUCKETS.findIndex((b) => a.ageDays < b.max);
    buckets[i === -1 ? BUCKETS.length - 1 : i].count += 1;
  }
  const avgAge = aged.length
    ? round1(aged.reduce((s, a) => s + a.ageDays, 0) / aged.length)
    : 0;

  const stalest = [...aged]
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 8)
    .map((a) => ({
      id: a.t.id,
      title: a.t.title,
      status: a.t.status,
      ageDays: round1(a.ageDays),
      project: a.t.project,
      assignees: a.t.assignees.map((x) => x.user),
    }));

  // Weekly intake vs throughput.
  const series: { weekStart: string; created: number; completed: number }[] = [];
  for (let i = 0; i < weeks; i++) {
    const wStart = new Date(startUtc.getTime() + i * WEEK_MS);
    const wEnd = new Date(wStart.getTime() + WEEK_MS);
    const created = createdRows.filter(
      (r) => r.createdAt >= wStart && r.createdAt < wEnd
    ).length;
    const completed = completedRows.filter(
      (r) => r.completedAt && r.completedAt >= wStart && r.completedAt < wEnd
    ).length;
    series.push({ weekStart: getBangkokDateString(wStart), created, completed });
  }
  const totalCreated = series.reduce((s, w) => s + w.created, 0);
  const totalDone = series.reduce((s, w) => s + w.completed, 0);

  res.json({
    weeks,
    aging: { buckets, avgDays: avgAge, openTotal: openTasks.length, stalest },
    flow: {
      series,
      openNow,
      totalCreated,
      totalCompleted: totalDone,
      // net change in backlog over the window (created − completed)
      net: totalCreated - totalDone,
    },
  });
}
