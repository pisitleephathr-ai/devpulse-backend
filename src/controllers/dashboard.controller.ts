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
    handoffLoad,
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
    // DEV_DONE / TESTING with a handoff tester belong to that tester (see
    // handoffLoad below), so they're skipped for the dev; but the same cards
    // WITHOUT a tester fall back to the dev so no work is orphaned — hence we
    // also need each task's handoffUserId here.
    prisma.taskAssignee.findMany({
      select: {
        userId: true,
        task: { select: { status: true, handoffUserId: true } },
      },
    }),
    // Cards in the tester's hands (dev done / actively testing) are attributed to
    // the handoff user (the tester), who is intentionally NOT an assignee.
    prisma.task.findMany({
      where: { status: { in: ["DEV_DONE", "TESTING"] }, handoffUserId: { not: null } },
      select: { handoffUserId: true, status: true },
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
  const testing = countBy("TESTING");
  const deliveryDone = countBy("DELIVERY_DONE");
  const deliveryFail = countBy("DELIVERY_FAIL");
  const total =
    todo + inProgress + devReview + devDone + testing + deliveryDone + deliveryFail;

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
  const emptyLoad = () => ({
    todo: 0,
    inProgress: 0,
    devReview: 0,
    devDone: 0,
    testing: 0,
    deliveryDone: 0,
    deliveryFail: 0,
  });
  const byUser = new Map<string, ReturnType<typeof emptyLoad>>();
  for (const g of workloadGroups) {
    const acc = byUser.get(g.userId) ?? emptyLoad();
    const st = g.task.status;
    if (st === "TODO") acc.todo += 1;
    else if (st === "IN_PROGRESS") acc.inProgress += 1;
    else if (st === "DEV_REVIEW") acc.devReview += 1;
    // DEV_DONE / TESTING with a tester belong to that tester (handoffLoad below);
    // without one they stay on the dev so the card isn't lost from all workloads.
    else if (st === "DEV_DONE" && !g.task.handoffUserId) acc.devDone += 1;
    else if (st === "TESTING" && !g.task.handoffUserId) acc.testing += 1;
    else if (st === "DELIVERY_DONE") acc.deliveryDone += 1;
    else if (st === "DELIVERY_FAIL") acc.deliveryFail += 1;
    byUser.set(g.userId, acc);
  }
  // Attribute dev-done / testing cards that HAVE a tester to that tester.
  for (const t of handoffLoad) {
    if (!t.handoffUserId) continue;
    const acc = byUser.get(t.handoffUserId) ?? emptyLoad();
    if (t.status === "DEV_DONE") acc.devDone += 1;
    else if (t.status === "TESTING") acc.testing += 1;
    byUser.set(t.handoffUserId, acc);
  }
  // Only roles flagged assignable show on the board. Non-assignable roles
  // (e.g. system admins) are hidden — but still shown if they actually hold
  // tasks, so no real work is ever hidden from managers. Testers surface via
  // their handoff cards even when they aren't assignees.
  const hasTasks = new Set<string>([
    ...workloadGroups.map((g) => g.userId),
    ...handoffLoad.map((t) => t.handoffUserId).filter((x): x is string => !!x),
  ]);
  const workload = activeUsers
    .filter((u) => (u.roleRef?.assignable ?? true) || hasTasks.has(u.id))
    .map((u) => {
      const c = byUser.get(u.id) ?? emptyLoad();
      const open = c.todo + c.inProgress + c.devReview + c.devDone + c.testing;
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
      testing,
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

/**
 * Weekly plan (1–2 weeks): a forward-looking, per-person view for the team
 * lead. For each assignable person it returns their open (not-yet-delivered)
 * tasks with the planning estimate (`estimatedFinishAt`), when they next become
 * free (the latest estimate among their open tasks), and which days in the
 * window they're on approved leave. Also returns the day cells with working-day
 * / holiday flags so the calendar can shade non-working days. Starts on the
 * Monday of the current Bangkok week.
 */
export async function plan(req: Request, res: Response) {
  const weeks = Math.min(2, Math.max(1, Number(req.query.weeks) || 1));
  const dayCount = weeks * 7;

  const todayStartUtc = startOfBangkokDayUtc(getBangkokDateString());
  const sinceMonday = (getBangkokWeekday() + 6) % 7; // Mon→0 … Sun→6
  const startUtc = new Date(todayStartUtc.getTime() - sinceMonday * DAY_MS);
  const endUtc = new Date(startUtc.getTime() + dayCount * DAY_MS);

  const [setting, holidays, users, assigneeRows, handoffRows, leaves] =
    await Promise.all([
    prisma.teamSetting.findFirst({ select: { workingDays: true } }),
    prisma.companyHoliday.findMany({
      where: { isActive: true, date: { gte: startUtc, lt: endUtc } },
      select: { date: true, name: true },
    }),
    prisma.user.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        avatarKey: true,
        roleRef: { select: { assignable: true } },
      },
      orderBy: { name: "asc" },
    }),
    // Dev-side open tasks per assignee — the forward load. DEV_DONE / TESTING
    // are handled by the handoff tester (handoffRows below) when a tester is set;
    // when none is set they fall back to the dev here so the card isn't lost.
    prisma.taskAssignee.findMany({
      where: {
        task: {
          OR: [
            { status: { in: ["TODO", "IN_PROGRESS", "DEV_REVIEW"] } },
            { status: { in: ["DEV_DONE", "TESTING"] }, handoffUserId: null },
          ],
        },
      },
      select: {
        userId: true,
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            estimatedFinishAt: true,
            startedAt: true,
            project: { select: { code: true, color: true, name: true } },
          },
        },
      },
    }),
    // Cards in a tester's hands (dev done / actively testing), attributed to the
    // handoff user rather than the dev who built them.
    prisma.task.findMany({
      where: { status: { in: ["DEV_DONE", "TESTING"] }, handoffUserId: { not: null } },
      select: {
        handoffUserId: true,
        id: true,
        title: true,
        status: true,
        dueDate: true,
        estimatedFinishAt: true,
        startedAt: true,
        project: { select: { code: true, color: true, name: true } },
      },
    }),
    // Approved leaves overlapping the window (full + half day) for shading.
    prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lt: endUtc }, endDate: { gte: startUtc } },
      select: { userId: true, startDate: true, endDate: true },
    }),
  ]);

  const workingSet = new Set(
    (setting?.workingDays ?? "1,2,3,4,5").split(",").filter(Boolean).map(Number)
  );
  const holidayByDate = new Map<string, string>();
  for (const h of holidays) holidayByDate.set(getBangkokDateString(h.date), h.name);

  const days = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(startUtc.getTime() + i * DAY_MS);
    const date = getBangkokDateString(d);
    const weekday = getBangkokWeekday(d);
    const holiday = holidayByDate.get(date) ?? null;
    return { date, weekday, isWorkingDay: workingSet.has(weekday) && !holiday, holiday };
  });

  const tasksByUser = new Map<string, typeof assigneeRows[number]["task"][]>();
  for (const r of assigneeRows) {
    const arr = tasksByUser.get(r.userId) ?? [];
    arr.push(r.task);
    tasksByUser.set(r.userId, arr);
  }
  // Testers carry their handoff cards (dev done / testing) in the same lane.
  for (const t of handoffRows) {
    if (!t.handoffUserId) continue;
    const arr = tasksByUser.get(t.handoffUserId) ?? [];
    arr.push({
      id: t.id,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate,
      estimatedFinishAt: t.estimatedFinishAt,
      startedAt: t.startedAt,
      project: t.project,
    });
    tasksByUser.set(t.handoffUserId, arr);
  }

  // Per-user set of window days covered by an approved leave.
  const leaveDatesByUser = new Map<string, Set<string>>();
  for (const lv of leaves) {
    const set = leaveDatesByUser.get(lv.userId) ?? new Set<string>();
    for (const c of days) {
      const cellStart = startOfBangkokDayUtc(c.date);
      const cellEnd = new Date(cellStart.getTime() + DAY_MS);
      if (lv.startDate < cellEnd && lv.endDate >= cellStart) set.add(c.date);
    }
    leaveDatesByUser.set(lv.userId, set);
  }

  const nowMs = Date.now();
  const people = users
    .filter((u) => (u.roleRef?.assignable ?? true) || tasksByUser.has(u.id))
    .map((u) => {
      const tks = [...(tasksByUser.get(u.id) ?? [])].sort((a, b) => {
        const ea = a.estimatedFinishAt ? a.estimatedFinishAt.getTime() : Infinity;
        const eb = b.estimatedFinishAt ? b.estimatedFinishAt.getTime() : Infinity;
        return ea - eb;
      });
      // "Free from" = the latest estimate among open tasks (busy until then).
      const estimates = tks
        .map((t) => t.estimatedFinishAt)
        .filter((d): d is Date => !!d);
      const latest = estimates.length
        ? estimates.reduce((a, b) => (a > b ? a : b))
        : null;
      return {
        id: u.id,
        name: u.name,
        avatarKey: u.avatarKey,
        openCount: tks.length,
        freeFrom: latest && latest.getTime() > nowMs ? latest.toISOString() : null,
        onLeaveDates: [...(leaveDatesByUser.get(u.id) ?? [])],
        tasks: tks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          dueDate: t.dueDate,
          estimatedFinishAt: t.estimatedFinishAt,
          startedAt: t.startedAt,
          project: t.project,
        })),
      };
    });

  res.json({ weeks, weekStart: getBangkokDateString(startUtc), days, people });
}
