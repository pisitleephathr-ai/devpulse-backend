/**
 * Bot command handlers for the rich menu's in-chat buttons. Each returns the
 * LINE message(s) to reply with. Personal commands (my_tasks) require the sender
 * to have linked their account so we know who they are.
 */
import type { TaskStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { appBaseUrl, type LineMessage } from "./line";
import { leaveTypeLabel, leaveDaysLabel } from "./line-messages";
import { getBangkokDateString, bangkokDateToUtcRange } from "./date";
import { workdayInfo } from "./workday";

/** Rich-menu postback commands. */
export const BOT_COMMANDS = ["my_tasks", "leave_today", "report_today"] as const;
export type BotCommand = (typeof BOT_COMMANDS)[number];

export function isBotCommand(s: string): s is BotCommand {
  return (BOT_COMMANDS as readonly string[]).includes(s);
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "รอดำเนินการ",
  IN_PROGRESS: "กำลังทำ",
  REVIEW: "รอตรวจ",
  READY_TO_TEST: "พร้อมทดสอบ",
  DONE: "เสร็จแล้ว",
};

function text(t: string): LineMessage {
  return { type: "text", text: t.slice(0, 4900) };
}

function thaiDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
  }).format(d);
}

function withLink(body: string, path: string): string {
  const base = appBaseUrl();
  return base ? `${body}\n\n🔗 ${base}${path}` : body;
}

/** "งานของฉัน" — the caller's open (not-done) tasks. Requires a linked account. */
async function myTasks(lineUserId: string): Promise<LineMessage[]> {
  const user = await prisma.user.findFirst({
    where: { lineUserId },
    select: { id: true, name: true },
  });
  if (!user) {
    return [
      text(
        "ยังไม่ได้เชื่อมต่อบัญชี — เปิดเว็บ DevPulse → โปรไฟล์ → เชื่อมต่อ LINE เพื่อดูงานของคุณที่นี่ครับ"
      ),
    ];
  }
  const tasks = await prisma.task.findMany({
    where: {
      status: { not: "DONE" },
      OR: [{ assigneeId: user.id }, { assignees: { some: { userId: user.id } } }],
    },
    select: {
      title: true,
      status: true,
      dueDate: true,
      project: { select: { code: true } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: 12,
  });
  if (!tasks.length) {
    return [text(`🎉 คุณ${user.name} ไม่มีงานค้างอยู่ตอนนี้`)];
  }
  const today = getBangkokDateString();
  let overdueCount = 0;
  const lines = tasks.map((t) => {
    const overdue = t.dueDate && getBangkokDateString(t.dueDate) < today;
    if (overdue) overdueCount += 1;
    const due = t.dueDate
      ? overdue
        ? ` · ⚠️ เลยกำหนด ${thaiDate(t.dueDate)}`
        : ` · ครบ ${thaiDate(t.dueDate)}`
      : "";
    return `${overdue ? "🔴" : "•"} [${t.project.code}] ${t.title}\n   ${STATUS_LABEL[t.status]}${due}`;
  });
  const head =
    `📋 งานของคุณ${user.name} (${tasks.length})` +
    (overdueCount ? ` · เลยกำหนด ${overdueCount}` : "");
  return [text(withLink(`${head}\n\n${lines.join("\n")}`, "/tasks"))];
}

/** "ใครลาวันนี้" — everyone on approved leave covering today. */
async function leaveToday(): Promise<LineMessage[]> {
  const today = getBangkokDateString();
  const { gte, lt } = bangkokDateToUtcRange(today);
  const leaves = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", startDate: { lt }, endDate: { gte } },
    select: {
      type: true,
      days: true,
      halfDayPeriod: true,
      user: { select: { name: true } },
    },
    orderBy: { user: { name: "asc" } },
  });
  if (!leaves.length) return [text("🌴 วันนี้ไม่มีใครลา")];
  const lines = leaves.map(
    (l) => `• ${l.user.name} — ${leaveTypeLabel(l.type)} · ${leaveDaysLabel(l.days, l.halfDayPeriod)}`
  );
  return [text(`🌴 วันนี้มีคนลา ${leaves.length} คน\n\n${lines.join("\n")}`)];
}

/** "สถานะรายงานวันนี้" — who has / hasn't submitted today's daily report. */
async function reportToday(): Promise<LineMessage[]> {
  const today = getBangkokDateString();
  const { isWorkingDay, holiday } = await workdayInfo(today);
  if (!isWorkingDay) {
    return [text(`วันนี้เป็นวันหยุด${holiday ? ` (${holiday.name})` : ""} — ไม่ต้องส่งรายงานครับ`)];
  }
  const { gte, lt } = bangkokDateToUtcRange(today);
  const [required, reports, leaves] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, requiresDailyReport: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.dailyReport.findMany({
      where: { date: { gte, lt } },
      select: { authorId: true },
    }),
    prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lt }, endDate: { gte } },
      select: { userId: true },
    }),
  ]);
  const onLeave = new Set(leaves.map((l) => l.userId));
  const submitted = new Set(reports.map((r) => r.authorId));
  const expected = required.filter((u) => !onLeave.has(u.id));
  const missing = expected.filter((u) => !submitted.has(u.id));
  const head = `📊 รายงานวันนี้ · ส่งแล้ว ${expected.length - missing.length}/${expected.length}`;
  const body =
    missing.length === 0
      ? "🎉 ส่งครบทุกคนแล้ว"
      : `ยังไม่ส่ง (${missing.length}):\n${missing.map((u) => `• ${u.name}`).join("\n")}`;
  return [text(withLink(`${head}\n\n${body}`, "/reports"))];
}

/** Run a bot command and return the reply message(s). */
export async function handleBotCommand(
  cmd: BotCommand,
  lineUserId: string
): Promise<LineMessage[]> {
  if (cmd === "my_tasks") return myTasks(lineUserId);
  if (cmd === "leave_today") return leaveToday();
  return reportToday();
}
