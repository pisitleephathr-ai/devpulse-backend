/**
 * Bot command handlers — triggered by rich-menu postbacks, typed keywords, or
 * interactive commands ("เสร็จ <งาน>", "งานของ <ชื่อ>"). Most replies are Flex
 * cards with tappable task rows. Personal commands require a linked account.
 */
import { prisma } from "./prisma";
import { appBaseUrl, type LineMessage } from "./line";
import {
  leaveTypeLabel,
  leaveDaysLabel,
  taskListFlex,
  type TaskRow,
} from "./line-messages";
import { getBangkokDateString, bangkokDateToUtcRange } from "./date";
import { workdayInfo } from "./workday";
import { logActivity } from "./activity";
import { expandPermissions } from "./roles";

const TEAL = "#0d9488";
const RED = "#dc2626";

/** Bot commands — triggered by a rich-menu postback OR a typed keyword. */
export const BOT_COMMANDS = [
  "my_tasks",
  "my_overdue",
  "due_today",
  "leave_today",
  "report_today",
  "help",
] as const;
export type BotCommand = (typeof BOT_COMMANDS)[number];

export function isBotCommand(s: string): s is BotCommand {
  return (BOT_COMMANDS as readonly string[]).includes(s);
}

/**
 * Match a free-typed message to a bot command (Thai + English keywords). More
 * specific patterns first. Returns null when nothing matches.
 */
export function matchTextCommand(raw: string): BotCommand | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (/(เมนู|คำสั่ง|ช่วยเหลือ|help|menu|\?)/.test(t)) return "help";
  if (/(เลยกำหนด|เกินกำหนด|ค้าง|overdue|late)/.test(t)) return "my_overdue";
  if (/(ครบกำหนด|กำหนดส่ง|due|deadline)/.test(t)) return "due_today";
  if (/(ใครลา|ลาวันนี้|วันลา|on leave|leave)/.test(t)) return "leave_today";
  if (/(รายงาน|report)/.test(t)) return "report_today";
  if (/(งาน|task|my task)/.test(t)) return "my_tasks";
  if (/(สวัสดี|hello|hi|hey|เริ่ม|start)/.test(t)) return "help";
  return null;
}

const SELF_WORDS = /^(ฉัน|ผม|หนู|เรา|ตัวเอง|me|my|mine)$/i;

/** "เสร็จ <ชื่องาน>" / "ปิดงาน <ชื่องาน>" → returns the task query, else null. */
export function parseCloseCommand(raw: string): string | null {
  const m = raw.trim().match(/^(?:เสร็จ|ปิดงาน|ปิด|done|close|finish)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** "งานของ <ชื่อ>" (not self) → returns the member name, else null. */
export function parseMemberCommand(raw: string): string | null {
  const m = raw.trim().match(/^งานของ\s*(.+)$/);
  if (!m) return null;
  const name = m[1].trim().replace(/[?？]/g, "").trim();
  if (!name || SELF_WORDS.test(name)) return null;
  return name;
}

function text(t: string): LineMessage {
  return { type: "text", text: t.slice(0, 4900) };
}
function flex(card: { altText: string; contents: LineMessage }): LineMessage {
  return { type: "flex", altText: card.altText.slice(0, 400), contents: card.contents };
}

function thaiDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
  }).format(d);
}

const TASK_ROW_SELECT = {
  id: true,
  title: true,
  status: true,
  dueDate: true,
  project: { select: { code: true } },
} as const;

type TaskLite = {
  id: string;
  title: string;
  status: TaskRow["status"];
  dueDate: Date | null;
  project: { code: string };
};

/** Map board tasks to tappable Flex rows (marks overdue vs today). */
function toRows(tasks: TaskLite[], base: string | null): TaskRow[] {
  const today = getBangkokDateString();
  return tasks.map((t) => ({
    title: `[${t.project.code}] ${t.title}`,
    status: t.status,
    due: t.dueDate ? thaiDate(t.dueDate) : null,
    overdue: !!t.dueDate && getBangkokDateString(t.dueDate) < today,
    url: base ? `${base}/tasks?task=${t.id}` : undefined,
  }));
}

const NOT_LINKED =
  "ยังไม่ได้เชื่อมต่อบัญชี — เปิดเว็บ DevPulse → โปรไฟล์ → เชื่อมต่อ LINE เพื่อใช้คำสั่งนี้ครับ";

/** Tasks assigned to a user (either the legacy primary or the join table). */
const assignedTo = (userId: string) => ({
  OR: [{ assigneeId: userId }, { assignees: { some: { userId } } }],
});

async function findLinkedUser(lineUserId: string) {
  return prisma.user.findFirst({
    where: { lineUserId },
    select: { id: true, name: true },
  });
}

/** "งานของฉัน" — the caller's open (not-done) tasks, as a Flex list. */
async function myTasks(lineUserId: string): Promise<LineMessage[]> {
  const user = await findLinkedUser(lineUserId);
  if (!user) return [text(NOT_LINKED)];
  const base = appBaseUrl();
  const tasks = await prisma.task.findMany({
    where: { status: { not: "DONE" }, ...assignedTo(user.id) },
    select: TASK_ROW_SELECT,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: 15,
  });
  if (!tasks.length) return [text(`🎉 คุณ${user.name} ไม่มีงานค้างอยู่ตอนนี้`)];
  const rows = toRows(tasks, base);
  const overdue = rows.filter((r) => r.overdue).length;
  const sub = `ทั้งหมด ${tasks.length} งาน${overdue ? ` · เลยกำหนด ${overdue}` : ""}`;
  return [
    flex(taskListFlex(`📋 งานของคุณ${user.name}`, TEAL, sub, rows, {
      footerUrl: base ? `${base}/tasks` : undefined,
    })),
  ];
}

/** "งานเลยกำหนดของฉัน" — the caller's not-done tasks past their due date. */
async function myOverdue(lineUserId: string): Promise<LineMessage[]> {
  const user = await findLinkedUser(lineUserId);
  if (!user) return [text(NOT_LINKED)];
  const base = appBaseUrl();
  const { gte } = bangkokDateToUtcRange(getBangkokDateString());
  const tasks = await prisma.task.findMany({
    where: { status: { not: "DONE" }, dueDate: { not: null, lt: gte }, ...assignedTo(user.id) },
    select: TASK_ROW_SELECT,
    orderBy: [{ dueDate: "asc" }],
    take: 20,
  });
  if (!tasks.length) return [text(`🎉 คุณ${user.name} ไม่มีงานเลยกำหนดครับ`)];
  return [
    flex(
      taskListFlex(`⚠️ งานเลยกำหนดของคุณ${user.name}`, RED, `${tasks.length} งาน`, toRows(tasks, base), {
        footerUrl: base ? `${base}/tasks` : undefined,
      })
    ),
  ];
}

/** "งานครบกำหนดวันนี้" — the caller's not-done tasks due today. */
async function dueToday(lineUserId: string): Promise<LineMessage[]> {
  const user = await findLinkedUser(lineUserId);
  if (!user) return [text(NOT_LINKED)];
  const base = appBaseUrl();
  const { gte, lt } = bangkokDateToUtcRange(getBangkokDateString());
  const tasks = await prisma.task.findMany({
    where: { status: { not: "DONE" }, dueDate: { gte, lt }, ...assignedTo(user.id) },
    select: TASK_ROW_SELECT,
    orderBy: [{ priority: "desc" }],
    take: 20,
  });
  if (!tasks.length) return [text(`วันนี้คุณ${user.name} ไม่มีงานครบกำหนดครับ 👍`)];
  return [
    flex(
      taskListFlex(`📅 ครบกำหนดวันนี้ · คุณ${user.name}`, TEAL, `${tasks.length} งาน`, toRows(tasks, base), {
        footerUrl: base ? `${base}/tasks` : undefined,
      })
    ),
  ];
}

/** "ใครลาวันนี้" — everyone on approved leave covering today. */
async function leaveToday(): Promise<LineMessage[]> {
  const { gte, lt } = bangkokDateToUtcRange(getBangkokDateString());
  const leaves = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", startDate: { lt }, endDate: { gte } },
    select: { type: true, days: true, halfDayPeriod: true, user: { select: { name: true } } },
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
    prisma.dailyReport.findMany({ where: { date: { gte, lt } }, select: { authorId: true } }),
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
  const base = appBaseUrl();
  return [text(`${head}\n\n${body}${base ? `\n\n🔗 ${base}/reports` : ""}`)];
}

/** Menu / help. */
function help(): LineMessage[] {
  return [
    text(
      "🤖 เมนูบอท DevPulse — พิมพ์คำสั่ง หรือกดปุ่มเมนูด้านล่าง:\n" +
        "• งานของฉัน / งานเลยกำหนด / งานครบกำหนดวันนี้\n" +
        "• ใครลาวันนี้ / สถานะรายงานวันนี้\n" +
        "• เสร็จ <ชื่องาน> — ปิดงานให้เลย\n" +
        "• งานของ <ชื่อ> — ดูงานของสมาชิก (สำหรับหัวหน้า)"
    ),
  ];
}

/** Interactive: "เสร็จ <ชื่องาน>" closes the caller's matching task. */
export async function closeTaskByName(
  lineUserId: string,
  query: string
): Promise<LineMessage[]> {
  const user = await findLinkedUser(lineUserId);
  if (!user) return [text(NOT_LINKED)];
  const q = query.trim();
  if (!q) return [text('พิมพ์ชื่องานต่อท้าย เช่น: "เสร็จ ทำหน้า login"')];
  const candidates = await prisma.task.findMany({
    where: {
      status: { not: "DONE" },
      ...assignedTo(user.id),
      title: { contains: q, mode: "insensitive" },
    },
    select: { id: true, title: true },
    take: 6,
  });
  if (!candidates.length)
    return [text(`ไม่พบงานที่ตรงกับ "${q}" ในงานที่ยังไม่เสร็จของคุณครับ`)];
  if (candidates.length > 1) {
    const lines = candidates.map((t) => `• ${t.title}`).join("\n");
    return [text(`พบหลายงานที่ตรงกัน — พิมพ์ให้ชัดเจนขึ้นนะครับ:\n${lines}`)];
  }
  const task = candidates[0];
  await prisma.task.update({
    where: { id: task.id },
    data: { status: "DONE", completedAt: new Date() },
  });
  await logActivity({
    userId: user.id,
    action: "task.status",
    message: `ปิดงาน "${task.title}" (ผ่าน LINE)`,
    entityType: "task",
    entityId: task.id,
  });
  const base = appBaseUrl();
  return [
    text(
      `✅ ปิดงาน "${task.title}" เรียบร้อยแล้ว 🎉${base ? `\n🔗 ${base}/tasks?task=${task.id}` : ""}`
    ),
  ];
}

/** "งานของ <ชื่อ>" — a manager can view another member's open tasks. */
export async function memberTasks(
  lineUserId: string,
  name: string
): Promise<LineMessage[]> {
  const caller = await prisma.user.findFirst({
    where: { lineUserId },
    select: { id: true, roleRef: { select: { code: true, permissions: true } } },
  });
  if (!caller) return [text(NOT_LINKED)];
  const perms = expandPermissions(caller.roleRef?.permissions, caller.roleRef?.code);
  if (!perms.has("TEAM_MANAGE")) {
    return [text('ดูได้เฉพาะงานของตัวเองครับ — พิมพ์ "งานของฉัน"')];
  }
  const target = await prisma.user.findFirst({
    where: { active: true, name: { contains: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!target) return [text(`ไม่พบสมาชิกชื่อ "${name}" ครับ`)];
  const base = appBaseUrl();
  const tasks = await prisma.task.findMany({
    where: { status: { not: "DONE" }, ...assignedTo(target.id) },
    select: TASK_ROW_SELECT,
    orderBy: [{ dueDate: "asc" }],
    take: 15,
  });
  if (!tasks.length) return [text(`${target.name} ไม่มีงานค้างอยู่ตอนนี้ 👍`)];
  const rows = toRows(tasks, base);
  const overdue = rows.filter((r) => r.overdue).length;
  return [
    flex(
      taskListFlex(
        `📋 งานของ${target.name}`,
        TEAL,
        `${tasks.length} งาน${overdue ? ` · เลยกำหนด ${overdue}` : ""}`,
        rows,
        { footerUrl: base ? `${base}/tasks` : undefined }
      )
    ),
  ];
}

/**
 * Build a personal "what needs attention" digest for a user: overdue + due today
 * + due tomorrow. Returns null when there's nothing (so the caller can skip).
 */
export async function buildDailyDigest(
  userId: string,
  name: string
): Promise<LineMessage[] | null> {
  const base = appBaseUrl();
  const today = getBangkokDateString();
  const { gte: todayStart, lt: todayEnd } = bangkokDateToUtcRange(today);
  const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000);

  const tasks = await prisma.task.findMany({
    where: { status: { not: "DONE" }, dueDate: { not: null, lt: tomorrowEnd }, ...assignedTo(userId) },
    select: TASK_ROW_SELECT,
    orderBy: [{ dueDate: "asc" }],
    take: 20,
  });
  if (!tasks.length) return null;

  const overdue = tasks.filter((t) => t.dueDate! < todayStart).length;
  const todayN = tasks.filter((t) => t.dueDate! >= todayStart && t.dueDate! < todayEnd).length;
  const tmN = tasks.filter((t) => t.dueDate! >= todayEnd && t.dueDate! < tomorrowEnd).length;
  const sub = `เลยกำหนด ${overdue} · วันนี้ ${todayN} · พรุ่งนี้ ${tmN}`;
  return [
    flex(
      taskListFlex(`☀️ สวัสดีคุณ${name} — งานที่ต้องดู`, TEAL, sub, toRows(tasks, base), {
        footerUrl: base ? `${base}/tasks` : undefined,
      })
    ),
  ];
}

/** Run a rich-menu / keyword bot command and return the reply message(s). */
export async function handleBotCommand(
  cmd: BotCommand,
  lineUserId: string
): Promise<LineMessage[]> {
  switch (cmd) {
    case "my_tasks":
      return myTasks(lineUserId);
    case "my_overdue":
      return myOverdue(lineUserId);
    case "due_today":
      return dueToday(lineUserId);
    case "leave_today":
      return leaveToday();
    case "report_today":
      return reportToday();
    case "help":
      return help();
  }
}
