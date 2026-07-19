import { env } from "./env";
import { prisma } from "./prisma";
import {
  notifColumn,
  roleAllowsNotif,
  type LineNotifKey,
} from "./line-notif";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

/** Resolve the target group id: the manual env override, else the auto-captured
 *  one stored on TeamSetting. Returns undefined when neither is set. */
async function resolveGroupId(): Promise<string | undefined> {
  if (env.LINE_GROUP_ID) return env.LINE_GROUP_ID;
  try {
    const s = await prisma.teamSetting.findFirst({ select: { lineGroupId: true } });
    return s?.lineGroupId ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a push can actually be delivered right now: LINE enabled + token set
 * AND a target group resolvable. Returns a Thai reason when not, for the
 * "send test" flow. (Regular pushes stay silent no-ops when not ready.)
 */
export async function lineDeliveryStatus(): Promise<{ ready: boolean; reason?: string }> {
  if (!env.LINE_ENABLED || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    return { ready: false, reason: "LINE ยังไม่เปิดใช้งานที่เซิร์ฟเวอร์" };
  }
  const groupId = await resolveGroupId();
  if (!groupId) {
    return { ready: false, reason: "ยังไม่ได้เชื่อมกลุ่ม LINE (เชิญบอทเข้ากลุ่มก่อน)" };
  }
  return { ready: true };
}

const QUOTA_URL = "https://api.line.me/v2/bot/message/quota";
const CONSUMPTION_URL = "https://api.line.me/v2/bot/message/quota/consumption";

/** Public frontend base URL (no trailing slash) for "open task" links, or null. */
export function appBaseUrl(): string | null {
  const raw = (
    env.APP_URL || (env.CORS_ORIGIN !== "*" ? env.CORS_ORIGIN.split(",")[0] : "")
  )
    .trim()
    .replace(/\/+$/, "");
  return /^https?:\/\//.test(raw) ? raw : null;
}

export type LineQuota = {
  /** "limited" = a monthly free/paid cap; "none" = unlimited (higher plan). */
  type: "limited" | "none";
  /** monthly cap (null when unlimited) */
  value: number | null;
  /** messages already sent this month toward the cap */
  used: number;
  /** value - used (null when unlimited) */
  remaining: number | null;
};

/**
 * Fetch this month's LINE message quota + consumption. Best-effort: returns
 * null when LINE is unconfigured or the API call fails. Quota checks do NOT
 * themselves count against the message quota.
 */
export async function getLineQuota(): Promise<LineQuota | null> {
  if (!env.LINE_ENABLED || !env.LINE_CHANNEL_ACCESS_TOKEN) return null;
  const headers = { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` };
  try {
    const [qRes, cRes] = await Promise.all([
      fetch(QUOTA_URL, { headers, signal: AbortSignal.timeout(4000) }),
      fetch(CONSUMPTION_URL, { headers, signal: AbortSignal.timeout(4000) }),
    ]);
    if (!qRes.ok || !cRes.ok) return null;
    const q = (await qRes.json()) as { type?: "limited" | "none"; value?: number };
    const c = (await cRes.json()) as { totalUsage?: number };
    const used = c.totalUsage ?? 0;
    const value = q.type === "limited" ? q.value ?? null : null;
    return {
      type: q.type ?? "none",
      value,
      used,
      remaining: value !== null ? Math.max(0, value - used) : null,
    };
  } catch {
    return null;
  }
}

/** Team LINE notification preferences (which events fan out to the group). */
export type LinePrefs = {
  notifyNewTask: boolean;
  statuses: string[];
  notifyLeave: boolean;
};

/** Read the team's LINE notification prefs (best-effort, safe defaults). */
export async function getLinePrefs(): Promise<LinePrefs> {
  try {
    const s = await prisma.teamSetting.findFirst({
      select: {
        lineNotifyNewTask: true,
        lineNotifyStatuses: true,
        lineNotifyLeave: true,
      },
    });
    return {
      notifyNewTask: s?.lineNotifyNewTask ?? true,
      statuses: s?.lineNotifyStatuses ?? ["TODO", "DONE"],
      notifyLeave: s?.lineNotifyLeave ?? true,
    };
  } catch {
    return { notifyNewTask: true, statuses: ["TODO", "DONE"], notifyLeave: true };
  }
}

/** A LINE message object (text or flex). Kept loose — shapes are built by callers. */
export type LineMessage = Record<string, unknown>;

/**
 * Push one or more messages to any LINE target (`to` = a group id OR a user id —
 * the Messaging API push endpoint treats both the same). Best-effort and gated:
 * a no-op unless LINE is enabled + the channel access token is set. Never throws
 * — a LINE failure must never break the mutation that triggered it (mirrors the
 * in-app notify() contract).
 */
async function pushMessagesTo(
  to: string,
  messages: LineMessage[]
): Promise<void> {
  if (!env.LINE_ENABLED || !env.LINE_CHANNEL_ACCESS_TOKEN || !messages.length) {
    return;
  }
  try {
    const res = await fetch(PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ to, messages: messages.slice(0, 5) }),
    });
    if (!res.ok) {
      // Surface auth/quota problems to logs without throwing.
      console.warn(`[line] push failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn("[line] push error:", err);
  }
}

/**
 * Push to the team's LINE group. Additionally gated on a resolvable group id
 * (a no-op when no group is linked). See pushMessagesTo for the base contract.
 */
export async function pushMessagesToLineGroup(
  messages: LineMessage[]
): Promise<void> {
  if (!messages.length) return;
  const groupId = await resolveGroupId();
  if (!groupId) return;
  await pushMessagesTo(groupId, messages);
}

/**
 * Push directly to a single user's personal LINE by our internal user id. A
 * silent no-op when that user hasn't linked their LINE account (no lineUserId).
 * Best-effort — never throws.
 */
export async function pushMessagesToUser(
  userId: string,
  messages: LineMessage[]
): Promise<void> {
  if (!env.LINE_ENABLED || !env.LINE_CHANNEL_ACCESS_TOKEN || !messages.length) {
    return;
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lineUserId: true },
    });
    if (!user?.lineUserId) return; // not linked → nothing to do
    await pushMessagesTo(user.lineUserId, messages);
  } catch (err) {
    console.warn("[line] push-to-user error:", err);
  }
}

/** Convenience: DM a single Flex bubble to a user (by internal id). */
export async function pushFlexToUser(
  userId: string,
  altText: string,
  contents: LineMessage
): Promise<void> {
  await pushMessagesToUser(userId, [
    { type: "flex", altText: altText.slice(0, 400), contents },
  ]);
}

/**
 * DM a set of users a personal notification of a given type, sent only to those
 * who (a) linked their LINE, (b) belong to a role that ALLOWS this type, and
 * (c) have the type enabled in their own preferences. One query resolves all
 * three. Best-effort — never throws.
 */
export async function pushToUsersWithPref(
  userIds: string[],
  key: LineNotifKey,
  messages: LineMessage[]
): Promise<void> {
  if (!env.LINE_ENABLED || !env.LINE_CHANNEL_ACCESS_TOKEN || !messages.length) {
    return;
  }
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const column = notifColumn(key);
  try {
    // Team-wide master switch: when off, no personal DMs at all.
    const setting = await prisma.teamSetting.findFirst({
      select: { linePersonalEnabled: true },
    });
    if (setting && setting.linePersonalEnabled === false) return;

    const users = await prisma.user.findMany({
      where: { id: { in: ids }, lineUserId: { not: null } },
      select: {
        lineUserId: true,
        lineNotifyTaskAssigned: true,
        lineNotifyLeaveDecision: true,
        lineNotifyLeaveRequest: true,
        lineNotifyReportReminder: true,
        roleRef: { select: { lineNotifications: true } },
      },
    });
    for (const u of users) {
      if (!u.lineUserId) continue;
      if (!roleAllowsNotif(u.roleRef?.lineNotifications, key)) continue; // role gate
      if (!u[column]) continue; // user opted out
      await pushMessagesTo(u.lineUserId, messages);
    }
  } catch (err) {
    console.warn("[line] push-with-pref error:", err);
  }
}

/** Convenience: pref-gated Flex DM to several users. */
export async function pushFlexToUsersWithPref(
  userIds: string[],
  key: LineNotifKey,
  altText: string,
  contents: LineMessage
): Promise<void> {
  await pushToUsersWithPref(userIds, key, [
    { type: "flex", altText: altText.slice(0, 400), contents },
  ]);
}

/**
 * Reply to an incoming webhook event using its one-time replyToken. Free (does
 * not consume push quota) but only valid for a short window right after the
 * event. Best-effort — never throws.
 */
export async function replyToLine(
  replyToken: string,
  messages: LineMessage[]
): Promise<void> {
  if (!env.LINE_ENABLED || !env.LINE_CHANNEL_ACCESS_TOKEN || !messages.length) {
    return;
  }
  try {
    const res = await fetch(REPLY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
    });
    if (!res.ok) {
      console.warn(`[line] reply failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn("[line] reply error:", err);
  }
}

/** Convenience: reply a single plain-text message to a webhook event. */
export async function replyTextToLine(
  replyToken: string,
  text: string
): Promise<void> {
  await replyToLine(replyToken, [{ type: "text", text: text.slice(0, 4900) }]);
}

/** Convenience: push a single plain-text message. */
export async function pushToLineGroup(text: string): Promise<void> {
  await pushMessagesToLineGroup([{ type: "text", text: text.slice(0, 4900) }]);
}

/** Convenience: push a single Flex bubble/carousel with a text fallback. */
export async function pushFlexToLineGroup(
  altText: string,
  contents: LineMessage
): Promise<void> {
  await pushMessagesToLineGroup([
    { type: "flex", altText: altText.slice(0, 400), contents },
  ]);
}
