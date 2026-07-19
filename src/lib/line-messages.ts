import type { TaskPriority, TaskStatus } from "@prisma/client";
import type { LineMessage } from "./line";

/** Brand + semantic colors used across the LINE task cards. */
const TEAL = "#0d9488";
const INK = "#1f2937";
const MUTED = "#9ca3af";
const HAIRLINE = "#e5e7eb";

const PRIORITY: Record<TaskPriority, { label: string; color: string }> = {
  HIGH: { label: "สูง", color: "#dc2626" },
  MEDIUM: { label: "ปานกลาง", color: "#d97706" },
  LOW: { label: "ต่ำ", color: "#16a34a" },
};

const STATUS: Record<TaskStatus, { label: string; color: string }> = {
  TODO: { label: "รอดำเนินการ", color: "#6b7280" },
  IN_PROGRESS: { label: "กำลังทำ", color: "#2563eb" },
  REVIEW: { label: "รอตรวจ", color: "#7c3aed" },
  READY_TO_TEST: { label: "พร้อมทดสอบ", color: "#0891b2" },
  DONE: { label: "เสร็จแล้ว", color: "#16a34a" },
};

/** Short Thai date in Bangkok tz with Buddhist year, e.g. "15 ก.ค. 2569". */
function thaiDate(date: Date | null): string {
  if (!date) return "ไม่กำหนด";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** A label→value row inside a bubble body. */
function row(label: string, value: string, valueColor = INK): LineMessage {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      // Wider label column + wrap so Thai labels aren't clipped on the narrow card.
      { type: "text", text: label, color: MUTED, size: "sm", flex: 4, wrap: true },
      {
        type: "text",
        text: value || "-",
        color: valueColor,
        size: "sm",
        flex: 6,
        wrap: true,
        weight: valueColor === INK ? "regular" : "bold",
      },
    ],
  };
}

/**
 * Shared bubble shell so every card looks like a matched set: a colored header
 * with a label, a body, and an optional footer button. The header/button color
 * defaults to the teal brand but can be themed per card (e.g. green for an
 * approval, red for a rejection).
 */
function shell(
  headerLabel: string,
  bodyContents: LineMessage[],
  opts: { url?: string; headerColor?: string; buttonLabel?: string } = {}
): LineMessage {
  const accent = opts.headerColor ?? TEAL;
  const bubble: LineMessage = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: accent,
      paddingAll: "16px",
      contents: [
        { type: "text", text: headerLabel, color: "#ffffff", size: "sm", weight: "bold" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "16px",
      contents: bodyContents,
    },
  };
  if (opts.url) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      paddingTop: "none",
      contents: [
        {
          type: "button",
          style: "primary",
          color: accent,
          height: "sm",
          action: { type: "uri", label: opts.buttonLabel ?? "เปิดดูงาน ↗", uri: opts.url },
        },
      ],
    };
  }
  return bubble;
}

/** Big bold task title used as the first body line on every card. */
function titleLine(title: string): LineMessage {
  return { type: "text", text: title, color: INK, size: "xl", weight: "bold", wrap: true };
}

/** Muted "by <name>" footer line inside the body. */
function actorLine(text: string): LineMessage {
  return { type: "text", text, color: MUTED, size: "xs", margin: "md" };
}

type TaskCardInput = {
  title: string;
  projectName: string;
  projectCode: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: Date | null;
  assignees: string[];
  actorName: string;
};

/** Flex card announcing a newly created task. */
export function taskCreatedFlex(
  t: TaskCardInput,
  url?: string
): { altText: string; contents: LineMessage } {
  const pri = PRIORITY[t.priority];
  const st = STATUS[t.status];
  const contents = shell(
    "📋 งานใหม่",
    [
      titleLine(t.title),
      row("โปรเจกต์", `${t.projectName} (${t.projectCode})`),
      row("ผู้รับผิดชอบ", t.assignees.length ? t.assignees.join(", ") : "ยังไม่มอบหมาย"),
      row("ความสำคัญ", pri.label, pri.color),
      row("กำหนดส่ง", thaiDate(t.dueDate)),
      row("สถานะ", st.label, st.color),
      { type: "separator", margin: "md", color: HAIRLINE },
      actorLine(`สร้างโดย ${t.actorName}`),
    ],
    { url }
  );
  return { altText: `📋 งานใหม่: ${t.title}`, contents };
}

type StatusCardInput = {
  title: string;
  projectName: string;
  projectCode: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus;
  actorName: string;
};

/** Flex card announcing a task status change (same shell as the New-task card). */
export function taskStatusFlex(
  t: StatusCardInput,
  url?: string
): { altText: string; contents: LineMessage } {
  const to = STATUS[t.toStatus];
  const from = t.fromStatus ? STATUS[t.fromStatus] : null;

  const transition: LineMessage[] = [];
  if (from) {
    transition.push(
      { type: "text", text: from.label, color: from.color, size: "sm", weight: "bold", flex: 0 },
      { type: "text", text: "→", color: MUTED, size: "sm", flex: 0, margin: "md" },
      { type: "text", text: to.label, color: to.color, size: "sm", weight: "bold", flex: 0, margin: "md" }
    );
  } else {
    transition.push({
      type: "text",
      text: to.label,
      color: to.color,
      size: "sm",
      weight: "bold",
      flex: 0,
    });
  }

  const contents = shell(
    "🔄 อัปเดตสถานะงาน",
    [
      titleLine(t.title),
      row("โปรเจกต์", `${t.projectName} (${t.projectCode})`),
      // Status gets its own full-width block (label on top, transition below)
      // so a long "จากเดิม → ใหม่" isn't clipped by sharing a row with the label.
      // The inner box stays "baseline" and holds only text — valid for LINE.
      { type: "box", layout: "vertical", spacing: "xs", contents: [
        { type: "text", text: "สถานะ", color: MUTED, size: "sm" },
        { type: "box", layout: "baseline", spacing: "sm", contents: transition },
      ] },
      { type: "separator", margin: "md", color: HAIRLINE },
      actorLine(`โดย ${t.actorName}`),
    ],
    { url }
  );
  return { altText: `🔄 ${t.title} → ${to.label}`, contents };
}

/* --------------------------------------------------------------------------
 * Leave + daily-summary cards
 * ------------------------------------------------------------------------ */

const LEAVE_TYPE_LABEL: Record<string, string> = {
  VACATION: "ลาพักร้อน",
  SICK: "ลาป่วย",
  PERSONAL: "ลากิจ",
  PARENTAL: "ลาเลี้ยงดูบุตร",
};

const HALF_LABEL: Record<string, string> = {
  MORNING: "ครึ่งวันเช้า",
  AFTERNOON: "ครึ่งวันบ่าย",
};

/** Human label for a leave type ("ลาป่วย"), falling back to the raw code. */
export function leaveTypeLabel(type: string): string {
  return LEAVE_TYPE_LABEL[type] ?? type;
}

/** e.g. "1 วัน" or "0.5 วัน (ครึ่งวันเช้า)" — shared leave duration label. */
export function leaveDaysLabel(days: number, half?: string | null): string {
  return half ? `${days} วัน (${HALF_LABEL[half] ?? "ครึ่งวัน"})` : `${days} วัน`;
}

/** A date span like "15 ก.ค. 2569" or "15 – 18 ก.ค. 2569". */
function dateRange(start: Date, end: Date): string {
  const a = thaiDate(start);
  const b = thaiDate(end);
  return a === b ? a : `${a} – ${b}`;
}

type LeaveCardInput = {
  userName: string;
  type: string;
  startDate: Date;
  endDate: Date;
  days: number;
  halfDayPeriod?: string | null;
  reason?: string | null;
  /** who approved/rejected (only shown on a decision card) */
  actorName?: string | null;
};

const LEAVE_DECISION = {
  PENDING: { header: "📝 คำขอลาใหม่", color: "#d97706", statusLabel: "รออนุมัติ", statusColor: "#d97706" },
  APPROVED: { header: "✅ อนุมัติการลา", color: "#16a34a", statusLabel: "อนุมัติแล้ว", statusColor: "#16a34a" },
  REJECTED: { header: "🚫 ไม่อนุมัติการลา", color: "#dc2626", statusLabel: "ไม่อนุมัติ", statusColor: "#dc2626" },
} as const;

/** Flex card for a leave request submitted / approved / rejected. */
export function leaveFlex(
  status: "PENDING" | "APPROVED" | "REJECTED",
  t: LeaveCardInput,
  url?: string
): { altText: string; contents: LineMessage } {
  const meta = LEAVE_DECISION[status];
  const body: LineMessage[] = [
    titleLine(t.userName),
    row("ประเภท", leaveTypeLabel(t.type)),
    row("ช่วงวันที่", dateRange(t.startDate, t.endDate)),
    row("จำนวน", leaveDaysLabel(t.days, t.halfDayPeriod)),
    row("สถานะ", meta.statusLabel, meta.statusColor),
  ];
  if (t.reason && t.reason.trim()) body.push(row("เหตุผล", t.reason.trim()));
  body.push({ type: "separator", margin: "md", color: HAIRLINE });
  body.push(
    actorLine(
      t.actorName ? `${status === "APPROVED" ? "อนุมัติโดย" : status === "REJECTED" ? "ปฏิเสธโดย" : "โดย"} ${t.actorName}` : "รอผู้จัดการพิจารณา"
    )
  );

  const contents = shell(meta.header, body, {
    url,
    headerColor: meta.color,
    buttonLabel: "เปิดดูคำขอ ↗",
  });
  return { altText: `${meta.header}: ${t.userName} (${leaveTypeLabel(t.type)})`, contents };
}

/** One "person on leave" line: bold name + muted "type · duration". */
function leaveEntryLine(name: string, detail: string): LineMessage {
  return {
    type: "box",
    layout: "vertical",
    spacing: "none",
    contents: [
      { type: "text", text: name, color: INK, size: "sm", weight: "bold", wrap: true },
      { type: "text", text: detail, color: MUTED, size: "xs", wrap: true },
    ],
  };
}

export type LeaveTodayEntry = { name: string; type: string; days: number; half?: string | null };

/** Flex card summarizing everyone on approved leave today. */
export function leaveTodayFlex(
  today: Date,
  entries: LeaveTodayEntry[],
  url?: string
): { altText: string; contents: LineMessage } {
  const body: LineMessage[] = [
    titleLine(`วันนี้มีคนลา ${entries.length} คน`),
    { type: "text", text: thaiDate(today), color: MUTED, size: "xs" },
    { type: "separator", margin: "md", color: HAIRLINE },
    ...entries.map((e) =>
      leaveEntryLine(e.name, `${leaveTypeLabel(e.type)} · ${leaveDaysLabel(e.days, e.half)}`)
    ),
  ];
  const contents = shell("🌴 วันนี้มีใครลา", body, {
    url,
    headerColor: "#0891b2",
    buttonLabel: "เปิดปฏิทินทีม ↗",
  });
  return { altText: `🌴 วันนี้มีคนลา ${entries.length} คน`, contents };
}

/** Trim + collapse whitespace and cap a snippet's length for a compact card. */
function clip(text: string, max = 90): string {
  const s = (text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** One submitter block: bold name (+ blocker flag) over a muted summary line. */
function reportEntryLine(entry: ReportEntry): LineMessage {
  const nameRow: LineMessage[] = [
    { type: "text", text: entry.name, color: INK, size: "sm", weight: "bold", flex: 0 },
  ];
  if (entry.blocked) {
    nameRow.push({
      type: "text",
      text: "⚠ ติดปัญหา",
      color: "#dc2626",
      size: "xs",
      flex: 0,
      margin: "sm",
    });
  }
  return {
    type: "box",
    layout: "vertical",
    spacing: "none",
    margin: "md",
    contents: [
      { type: "box", layout: "baseline", spacing: "sm", contents: nameRow },
      { type: "text", text: clip(entry.detail) || "—", color: MUTED, size: "xs", wrap: true },
    ],
  };
}

export type ReportEntry = { name: string; detail: string; blocked: boolean };

/**
 * Flex card summarizing daily-report submission: a per-person breakdown of what
 * each submitter reported (brief), plus who still hasn't sent one.
 */
export function reportSummaryFlex(
  today: Date,
  data: { total: number; submitted: ReportEntry[]; missingNames: string[] },
  url?: string
): { altText: string; contents: LineMessage } {
  // The date is the headline (which day this is for); the count is redundant
  // with the "ครบทุกคนแล้ว / ยังไม่ส่ง" line below, so it isn't repeated here.
  const body: LineMessage[] = [
    titleLine(thaiDate(today)),
    { type: "text", text: `รายงานประจำวัน · ส่งแล้ว ${data.submitted.length}/${data.total}`, color: MUTED, size: "xs" },
  ];

  if (data.submitted.length) {
    body.push({ type: "separator", margin: "md", color: HAIRLINE });
    // Cap the number of detailed rows so a big team can't blow the bubble size.
    const MAX_ROWS = 12;
    for (const e of data.submitted.slice(0, MAX_ROWS)) body.push(reportEntryLine(e));
    if (data.submitted.length > MAX_ROWS) {
      body.push({
        type: "text",
        text: `…และอีก ${data.submitted.length - MAX_ROWS} คน`,
        color: MUTED,
        size: "xs",
        margin: "md",
      });
    }
  }

  body.push({ type: "separator", margin: "md", color: HAIRLINE });
  if (data.missingNames.length === 0) {
    body.push({
      type: "text",
      text: "🎉 ส่งรายงานครบทุกคนแล้ว",
      color: "#16a34a",
      size: "sm",
      weight: "bold",
      wrap: true,
    });
  } else {
    body.push(
      { type: "text", text: `ยังไม่ส่ง (${data.missingNames.length})`, color: "#dc2626", size: "sm", weight: "bold" },
      { type: "text", text: data.missingNames.join(", "), color: INK, size: "sm", wrap: true }
    );
  }

  const contents = shell("📊 สรุปรายงานประจำวัน", body, {
    url,
    headerColor: TEAL,
    buttonLabel: "เปิดดูรายงาน ↗",
  });
  return {
    altText: `📊 รายงานประจำวัน: ส่งแล้ว ${data.submitted.length}/${data.total}`,
    contents,
  };
}

export type PerformanceEntry = {
  name: string;
  closed: number;
  onTime: number;
  late: number;
  rate: number;
};

/** One performance row: name + a colored on-time %, with closed/late detail. */
function performanceRow(e: PerformanceEntry, medal: string): LineMessage {
  const color = e.rate >= 80 ? "#16a34a" : e.rate >= 50 ? "#d97706" : "#dc2626";
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    margin: "md",
    contents: [
      { type: "text", text: medal, size: "sm", flex: 0 },
      { type: "text", text: e.name, color: INK, size: "sm", weight: "bold", flex: 5, wrap: true },
      { type: "text", text: `${e.rate}%`, color, size: "sm", weight: "bold", align: "end", flex: 2 },
    ],
  };
}

/**
 * Weekly team performance card: on-time completion ranking. `entries` are already
 * sorted best-first by the caller. Shows a "top" group and a "needs improvement"
 * group so the team can see who's on track and who's slipping.
 */
export function performanceSummaryFlex(
  rangeLabel: string,
  entries: PerformanceEntry[],
  url?: string
): { altText: string; contents: LineMessage } {
  const body: LineMessage[] = [
    titleLine("สรุปผลงานทีม"),
    { type: "text", text: `ปิดงานตรงเวลา · ${rangeLabel}`, color: MUTED, size: "xs" },
  ];

  if (!entries.length) {
    body.push(
      { type: "separator", margin: "md", color: HAIRLINE },
      { type: "text", text: "ยังไม่มีงานที่ปิดพร้อมกำหนดส่งในช่วงนี้", color: MUTED, size: "sm", wrap: true }
    );
  } else {
    const top = entries.slice(0, 5);
    const worst = [...entries].reverse().find((e) => e.late > 0);

    body.push({ type: "separator", margin: "md", color: HAIRLINE });
    body.push({ type: "text", text: "🏆 ผลงานดี", color: "#16a34a", size: "xs", weight: "bold", margin: "md" });
    top.forEach((e, i) =>
      body.push(performanceRow(e, i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•"))
    );

    if (worst && !top.slice(0, 3).includes(worst)) {
      body.push({ type: "separator", margin: "md", color: HAIRLINE });
      body.push({ type: "text", text: "⚠️ ควรปรับปรุง (ปิดงานไม่ตรงแผน)", color: "#dc2626", size: "xs", weight: "bold", margin: "md" });
      body.push(performanceRow(worst, "⚠️"));
      body.push({
        type: "text",
        text: `ปิดสาย ${worst.late} จาก ${worst.closed} งาน`,
        color: MUTED,
        size: "xs",
      });
    }
  }

  const contents = shell("🏆 สรุปผลงานทีม", body, {
    url,
    headerColor: TEAL,
    buttonLabel: "เปิดแดชบอร์ด ↗",
  });
  return { altText: `🏆 สรุปผลงานทีม (${rangeLabel})`, contents };
}
