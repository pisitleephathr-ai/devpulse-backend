import type { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { replyTextToLine } from "../lib/line";
import { linkByCode, unlinkByLineUserId } from "../lib/line-link";

// Minimal fields required to create the singleton if it doesn't exist yet.
const DEFAULT_SETTING = { teamName: "ทีมแพลตฟอร์ม", reportReminderTime: "16:30 น." };

/** Verify LINE's X-Line-Signature: base64(HMAC-SHA256(rawBody, channelSecret)). */
function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!env.LINE_CHANNEL_SECRET || !signature) return false;
  const expected = crypto
    .createHmac("sha256", env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Store (or clear) the captured group id on the singleton TeamSetting. No-op
 *  when unchanged so ordinary group chatter doesn't cause needless writes. */
async function setGroupId(groupId: string | null) {
  const existing = await prisma.teamSetting.findFirst({
    select: { id: true, lineGroupId: true },
  });
  if (existing) {
    if (existing.lineGroupId === groupId) return;
    await prisma.teamSetting.update({
      where: { id: existing.id },
      data: { lineGroupId: groupId },
    });
  } else if (groupId) {
    await prisma.teamSetting.create({
      data: { ...DEFAULT_SETTING, lineGroupId: groupId },
    });
  }
}

const LINK_HELP =
  "ส่งรหัสเชื่อมต่อ 6 หลักที่ได้จากหน้า “โปรไฟล์ → เชื่อมต่อ LINE” ในระบบ DevPulse เพื่อผูกบัญชีนะครับ";

/**
 * Handle a 1:1 (personal) webhook event. A text message is treated as a link
 * code: matching one binds the sender's LINE id to that user's account. `follow`
 * greets with linking instructions; `unfollow` unlinks (the user blocked the
 * bot). All replies/DB writes are best-effort — a webhook must never fail loudly.
 */
async function handleUserEvent(ev: {
  type?: string;
  replyToken?: string;
  message?: { type?: string; text?: string };
  source?: { userId?: string };
}): Promise<void> {
  const lineUserId = ev.source?.userId;
  if (!lineUserId) return;

  if (ev.type === "unfollow") {
    await unlinkByLineUserId(lineUserId);
    return;
  }

  if (ev.type === "follow") {
    if (ev.replyToken) {
      await replyTextToLine(
        ev.replyToken,
        `สวัสดีครับ 👋 นี่คือบอทแจ้งเตือนของ DevPulse\n${LINK_HELP}`
      );
    }
    return;
  }

  if (ev.type === "message" && ev.message?.type === "text") {
    const text = (ev.message.text ?? "").trim();
    if (!text) return;
    const linked = await linkByCode(text, lineUserId);
    if (!ev.replyToken) return;
    if (linked) {
      await replyTextToLine(
        ev.replyToken,
        `✅ เชื่อมต่อบัญชีสำเร็จ คุณ${linked.name}\nจากนี้จะได้รับการแจ้งเตือนงานส่วนตัวทาง LINE นี้ครับ`
      );
    } else {
      await replyTextToLine(
        ev.replyToken,
        `ไม่พบรหัสนี้ หรือรหัสหมดอายุแล้ว\n${LINK_HELP}`
      );
    }
  }
}

/**
 * LINE Messaging API webhook. Verifies the signature over the RAW body, then
 * auto-captures the group id from any group-sourced event (so admins never have
 * to hunt for it) and handles 1:1 events for personal account linking. Mounted
 * with express.raw() BEFORE express.json() so req.body is the raw Buffer. Always
 * acknowledges with 200 (except a bad signature) — a webhook must never fail loudly.
 */
export async function lineWebhook(req: Request, res: Response) {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    // No secret configured → can't verify. Ack the Console "Verify" ping but
    // never process events.
    if (!env.LINE_CHANNEL_SECRET) {
      res.status(200).end();
      return;
    }
    if (!verifySignature(raw, req.header("x-line-signature"))) {
      res.status(401).end();
      return;
    }

    const body = JSON.parse(raw.toString("utf8") || "{}") as {
      events?: Array<{
        type?: string;
        replyToken?: string;
        message?: { type?: string; text?: string };
        source?: { type?: string; groupId?: string; userId?: string };
      }>;
    };
    for (const ev of body.events ?? []) {
      if (ev.source?.type === "group") {
        const gid = ev.source.groupId;
        if (!gid) continue;
        if (ev.type === "leave") {
          // Bot was removed — forget the group only if it's the one we push to.
          const s = await prisma.teamSetting.findFirst({
            select: { lineGroupId: true },
          });
          if (s?.lineGroupId === gid) await setGroupId(null);
        } else {
          await setGroupId(gid); // join / message / etc. → remember it
        }
        continue;
      }

      // 1:1 (personal) events drive account linking.
      if (ev.source?.type === "user") {
        await handleUserEvent(ev);
      }
    }
    res.status(200).end();
  } catch {
    res.status(200).end();
  }
}
