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
      { type: "text", text: label, color: MUTED, size: "sm", flex: 2 },
      {
        type: "text",
        text: value || "-",
        color: valueColor,
        size: "sm",
        flex: 5,
        wrap: true,
        weight: valueColor === INK ? "regular" : "bold",
      },
    ],
  };
}

/**
 * Shared bubble shell so both card types look identical: a teal header with an
 * icon+label, a body, and an optional "open task" footer button. Keeping one
 * shell is what makes the New-task and Status cards a matched set.
 */
function shell(
  headerLabel: string,
  bodyContents: LineMessage[],
  url?: string
): LineMessage {
  const bubble: LineMessage = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: TEAL,
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
  if (url) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      paddingTop: "none",
      contents: [
        {
          type: "button",
          style: "primary",
          color: TEAL,
          height: "sm",
          action: { type: "uri", label: "เปิดดูงาน ↗", uri: url },
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
    url
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
      { type: "box", layout: "baseline", spacing: "sm", contents: [
        { type: "text", text: "สถานะ", color: MUTED, size: "sm", flex: 2 },
        { type: "box", layout: "baseline", flex: 5, contents: transition },
      ] },
      { type: "separator", margin: "md", color: HAIRLINE },
      actorLine(`โดย ${t.actorName}`),
    ],
    url
  );
  return { altText: `🔄 ${t.title} → ${to.label}`, contents };
}
