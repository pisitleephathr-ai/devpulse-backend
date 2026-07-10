import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { notifyMany } from "../lib/notify";

const NO_BLOCKER = new Set(["", "ไม่มี", "—", "-", "วันนี้ไม่มี", "ไม่มีครับ", "ไม่มีค่ะ"]);
function cleanBlocker(s: string) {
  return NO_BLOCKER.has(s.trim()) ? "" : s.trim();
}

/** Today's date (YYYY-MM-DD) in Asia/Bangkok, computed server-side (UTC+7). */
function bangkokToday(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** UTC range covering a Bangkok calendar day (reports are stored at UTC midnight). */
function dayRange(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 3_600_000);
  return { gte: start, lt: end };
}

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
            task: { select: { id: true, title: true, status: true, priority: true } },
          },
          orderBy: { createdAt: "asc" },
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
  const missingUsers = required
    .filter((u) => !submittedIds.has(u.id))
    .map(({ requiresDailyReport, ...u }) => u);
  const exemptUsers = activeUsers
    .filter((u) => !u.requiresDailyReport)
    .map(({ requiresDailyReport, ...u }) => u);

  // Related tasks now come from the explicit report↔task links a member chose
  // (deduped per user, capped for a compact standup view). Reports without any
  // linked tasks simply contribute none — keeping standup report-focused.
  type MiniTask = (typeof reports)[number]["relatedTasks"][number]["task"];
  const tasksByUser = new Map<string, MiniTask[]>();
  for (const r of reports) {
    const arr = tasksByUser.get(r.authorId) ?? [];
    for (const rt of r.relatedTasks) {
      if (arr.length >= 5) break;
      if (!arr.some((t) => t.id === rt.task.id)) arr.push(rt.task);
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
      });
    } else {
      cur.did = mergeText(cur.did, r.did);
      cur.plan = mergeText(cur.plan, r.plan);
      cur.blockers = mergeText(cur.blockers, blk);
      cur.project = r.project ?? cur.project;
      cur.status = r.status;
      cur.id = r.id;
      cur.reportCount += 1;
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
      exempt: exemptUsers.length,
      totalRequired: required.length,
      blockers: blockers.length,
      tasksDueToday,
    },
    submittedReports,
    missingUsers,
    exemptUsers,
    blockers,
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

  res.json({ notified: missing.length });
}
