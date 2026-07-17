import { env } from "./env";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";

/**
 * Push a plain-text message to the team's LINE group via the Messaging API.
 * Best-effort and fully gated: a no-op unless LINE is enabled AND both the
 * channel access token and target group id are configured. Never throws — a
 * LINE failure must never break the mutation that triggered it (mirrors the
 * in-app notify() contract).
 */
export async function pushToLineGroup(text: string): Promise<void> {
  if (!env.LINE_ENABLED || !env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_GROUP_ID) {
    return;
  }
  try {
    const res = await fetch(PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: env.LINE_GROUP_ID,
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
