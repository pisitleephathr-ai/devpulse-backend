import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { notifyMany } from "../lib/notify";
import { pushToUsersWithPref, appBaseUrl } from "../lib/line";
import { getBangkokDateString, bangkokDateToUtcRange } from "../lib/date";
import { workdayInfo } from "../lib/workday";
import { onLeaveUserIds } from "../lib/leave-status";

const NO_BLOCKER = new Set(["", "ไม่มี", "—", "-", "วันนี้ไม่มี", "ไม่มีครับ", "ไม่มีค่ะ"]);
function cleanBlocker(s: string) {
  return NO_BLOCKER.has(s.trim()) ? "" : s.trim();
}

// Bangkok date helpers come from src/lib/date.ts (single source of truth).
const bangkokToday = getBangkokDateString;
const dayRange = bangkokDateToUtcRange;

/**
 * GET /api/standup?date=YYYY-MM-DD — the daily standup summary for a Bangkok day
 * (defaults to today). Team-wide reports are already visible to any authenticated
 * user (same as /reports and the dashboard), so this mirrors that visibility.
 */
export async function standup(req: Request, res: Response) {
  const dateStr = (req.query.date as string) || bangkokToday();
  const range = dayRange(dateStr);

  const today = bangkokToday();
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const todayEnd = new Date(todayStart.getTime() + 24 * 3_600_000);

  const [activeUsers, reports, tasksDueToday] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, avatarKey: true, requiresDailyReport: true },
      orderBy: { name: "asc" },
    }),
    prisma.dailyReport.findMany({
      where: { date: range },
      include: {
        author: { select: userMiniSelect },
        project: { select: { name: true, code: true, color: true } },
        relatedTasks: {
          include: {
            task: {
              select: {
                id: true,
                title: true,
                status: true,
                priority: true,
                dueDate: true,
                project: { select: { code: true, color: true, name: true } },
                assignees: {
                  select: { user: { select: { id: true, name: true, avatarKey: true } } },
                },
                checklist: { select: { done: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        items: {
          select: { id: true, section: true, title: true, progress: true, note: true },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.task.count({
      where: { status: { not: "DONE" }, dueDate: { gte: todayStart, lt: todayEnd } },
    }),
  ]);

  const submittedIds = new Set(reports.map((r) => r.authorId));
  const required = activeUsers.filter((u) => u.requiresDailyReport);
  // On a non-working day (weekend / company holiday) no report is expected, so
  // nobody is "missing" — the UI shows a holiday state instead.
  const { isWorkingDay, holiday } = await workdayInfo(dateStr);
  // People on APPROVED leave that day aren't expected to report and are shown as
  // "on leave" instead of "missing".
  const onLeave = await onLeaveUserIds(dateStr);
  const strip = ({ requiresDailyReport, ...u }: (typeof activeUsers)[number]) => u;
  const missingUsers = (isWorkingDay
    ? required.filter((u) => !submittedIds.has(u.id) && !onLeave.has(u.id))
    : []
  ).map(strip);
  // On-leave, required members who didn't submit — surfaced as a separate group.
  const onLeaveUsers = required
    .filter((u) => onLeave.has(u.id) && !submittedIds.has(u.id))
    .map(strip);
  const exemptUsers = activeUsers
    .filter((u) => !u.requiresDailyReport)
    .map(strip);

  // Related tasks now come from the explicit report↔task links a member chose
  // (deduped per user, capped for a compact standup view). Reports without any
  // linked tasks simply contribute none — keeping standup report-focused. Each
  // task is flattened to a lightweight shape with the detail the standup UI
  // needs (due date, project, assignees, checklist progress).
  type RawTask = (typeof reports)[number]["relatedTasks"][number]["task"];
  const serializeTask = (t: RawTask) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    project: t.project,
    assignees: t.assignees.map((a) => a.user),
    checklistTotal: t.checklist.length,
    checklistDone: t.checklist.filter((c) => c.done).length,
  });
  type MiniTask = ReturnType<typeof serializeTask>;
  const tasksByUser = new Map<string, MiniTask[]>();
  for (const r of reports) {
    const arr = tasksByUser.get(r.authorId) ?? [];
    for (const rt of r.relatedTasks) {
      if (arr.length >= 6) break;
      if (!arr.some((t) => t.id === rt.task.id)) arr.push(serializeTask(rt.task));
    }
    tasksByUser.set(r.authorId, arr);
  }

  // Merge duplicate reports per required user into ONE entry so each person
  // appears once in the standup queue. Exempt users are excluded entirely.
  // Reports are ordered createdAt asc, so later text is appended / wins.
  const requiredIds = new Set(required.map((u) => u.id));
  const mergeText = (a: string, b: string) => {
    const x = (a || "").trim();
    const y = (b || "").trim();
    if (!y) return x;
    if (!x) return y;
    return x.includes(y) ? x : `${x}\n${y}`;
  };

  type MergedReport = {
    id: string;
    user: (typeof reports)[number]["author"];
    did: string;
    plan: string;
    blockers: string;
    project: (typeof reports)[number]["project"];
    status: string;
    reportCount: number;
    tasks: NonNullable<ReturnType<typeof tasksByUser.get>>;
    items: (typeof reports)[number]["items"];
  };
  const byAuthor = new Map<string, MergedReport>();
  for (const r of reports) {
    if (!requiredIds.has(r.authorId)) continue; // exclude exempt users
    const blk = cleanBlocker(r.blockers);
    const cur = byAuthor.get(r.authorId);
    if (!cur) {
      byAuthor.set(r.authorId, {
        id: r.id,
        user: r.author,
        did: r.did,
        plan: r.plan,
        blockers: blk,
        project: r.project,
        status: r.status,
        reportCount: 1,
        tasks: tasksByUser.get(r.authorId) ?? [],
        items: [...r.items],
      });
    } else {
      cur.did = mergeText(cur.did, r.did);
      cur.plan = mergeText(cur.plan, r.plan);
      cur.blockers = mergeText(cur.blockers, blk);
      cur.project = r.project ?? cur.project;
      cur.status = r.status;
      cur.id = r.id;
      cur.reportCount += 1;
      cur.items.push(...r.items);
    }
  }
  const submittedReports = [...byAuthor.values()].sort((a, b) =>
    a.user.name.localeCompare(b.user.name, "th")
  );

  const blockers = submittedReports
    .filter((r) => r.blockers.length > 0)
    .map((r) => ({ id: r.id, user: r.user, text: r.blockers, project: r.project }));

  res.json({
    date: dateStr,
    stats: {
      // unique required users who submitted (not raw report count)
      submitted: submittedReports.length,
      missing: missingUsers.length,
      onLeave: onLeaveUsers.length,
      exempt: exemptUsers.length,
      totalRequired: required.length,
      blockers: blockers.length,
      tasksDueToday,
    },
    submittedReports,
    missingUsers,
    onLeaveUsers,
    exemptUsers,
    blockers,
    isWorkingDay,
    holiday,
  });
}

/**
 * POST /api/standup/remind — send an in-app reminder to everyone who is active,
 * required to report, and hasn't submitted for the given (or today's) day.
 * Manager/admin only (enforced at the route).
 */
export async function remind(req: Request, res: Response) {
  const dateStr = (req.body?.date as string) || bangkokToday();
  const range = dayRange(dateStr);

  // No reminders on a non-working day (weekend / company holiday).
  const { isWorkingDay } = await workdayInfo(dateStr);
  if (!isWorkingDay) {
    res.json({ notified: 0 });
    return;
  }

  const [required, reports] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, requiresDailyReport: true },
      select: { id: true },
    }),
    prisma.dailyReport.findMany({ where: { date: range }, select: { authorId: true } }),
  ]);
  const submitted = new Set(reports.map((r) => r.authorId));
  const missing = required
    .map((u) => u.id)
    .filter((id) => !submitted.has(id) && id !== req.user!.id);

  await notifyMany(missing, {
    type: "report.reminder",
    title: "อย่าลืมส่งรายงานประจำวัน",
    message: "กรุณาส่งรายงานประจำวันสำหรับการประชุมเช้า",
    entityType: "report",
  });

  // Also nudge on personal LINE (per-user pref; linked users only).
  const base = appBaseUrl();
  await pushToUsersWithPref(missing, "reportReminder", [
    {
      type: "text",
      text:
        "⏰ อย่าลืมส่งรายงานประจำวันนะครับ" +
        (base ? `\nส่งได้ที่: ${base}/reports` : ""),
    },
  ]);

  res.json({ notified: missing.length });
}
