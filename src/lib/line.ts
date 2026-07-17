import { env } from "./env";
import { prisma } from "./prisma";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";

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
 * Push a plain-text message to the team's LINE group via the Messaging API.
 * Best-effort and fully gated: a no-op unless LINE is enabled AND both the
 * channel access token and target group id are configured. Never throws — a
 * LINE failure must never break the mutation that triggered it (mirrors the
 * in-app notify() contract).
 */
export async function pushToLineGroup(text: string): Promise<void> {
  if (!env.LINE_ENABLED || !env.LINE_CHANNEL_ACCESS_TOKEN) return;
  const groupId = await resolveGroupId();
  if (!groupId) return;
  try {
    const res = await fetch(PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: "text", text: text.slice(0, 4900) }],
      }),
    });
    if (!res.ok) {
      // Surface auth/quota problems to logs without throwing.
      console.warn(`[line] push failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn("[line] push error:", err);
  }
}
