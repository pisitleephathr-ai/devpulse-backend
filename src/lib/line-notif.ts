/**
 * Personal-LINE notification types — the single source of truth shared by the
 * push path, the per-user preference columns, and the per-role allow list.
 *
 * Two-level model:
 *  - Role.lineNotifications = which types a role is ALLOWED to receive (admin
 *    policy). Empty = inherit the default (all types allowed), matching the
 *    menuAccess convention.
 *  - User.lineNotify<Type> booleans = the user's own on/off WITHIN what their
 *    role allows. A DM is sent only when the role allows the type AND the user
 *    has it enabled.
 */

export const LINE_NOTIF_TYPES = [
  { key: "taskAssigned", column: "lineNotifyTaskAssigned", label: "งานที่ได้รับมอบหมาย" },
  { key: "taskStatus", column: "lineNotifyTaskStatus", label: "สถานะงานของฉันเปลี่ยน" },
  { key: "mention", column: "lineNotifyMention", label: "ถูกพูดถึง (@) ในคอมเมนต์" },
  { key: "leaveDecision", column: "lineNotifyLeaveDecision", label: "ผลอนุมัติการลา (ของฉัน)" },
  { key: "leaveRequest", column: "lineNotifyLeaveRequest", label: "คำขอลาใหม่ (สำหรับผู้อนุมัติ)" },
  { key: "reportReminder", column: "lineNotifyReportReminder", label: "เตือนส่งรายงานประจำวัน" },
] as const;

export type LineNotifKey = (typeof LINE_NOTIF_TYPES)[number]["key"];
export type LineNotifColumn = (typeof LINE_NOTIF_TYPES)[number]["column"];

export const LINE_NOTIF_KEYS = LINE_NOTIF_TYPES.map((t) => t.key) as LineNotifKey[];

/** Map a notification key to its User boolean-preference column. */
export function notifColumn(key: LineNotifKey): LineNotifColumn {
  return LINE_NOTIF_TYPES.find((t) => t.key === key)!.column;
}

/**
 * Whether a role permits a notification type. Empty/absent list = all allowed
 * (default), mirroring how an empty menuAccess inherits the built-in defaults.
 */
export function roleAllowsNotif(
  allowed: readonly string[] | null | undefined,
  key: string
): boolean {
  return !allowed || allowed.length === 0 ? true : allowed.includes(key);
}

/** The keys a role effectively allows (used to drive the profile toggles). */
export function allowedNotifKeys(
  allowed: readonly string[] | null | undefined
): LineNotifKey[] {
  return LINE_NOTIF_KEYS.filter((k) => roleAllowsNotif(allowed, k));
}
