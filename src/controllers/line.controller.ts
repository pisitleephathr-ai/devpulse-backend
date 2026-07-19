import type { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { replyToLine } from "../lib/line";
import { infoFlex } from "../lib/line-messages";
import { linkByCode, unlinkByLineUserId } from "../lib/line-link";
import { handleLeaveDecision } from "../lib/line-leave";
import {
  handleBotCommand,
  isBotCommand,
  matchTextCommand,
  parseCloseCommand,
  parseMemberCommand,
  closeTaskByName,
  memberTasks,
} from "../lib/line-commands";

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

/** Reply a single info card (all bot replies are cards). */
async function replyCard(
  token: string,
  header: string,
  color: string,
  body: string
): Promise<void> {
  const c = infoFlex(header, color, body);
  await replyToLine(token, [{ type: "flex", altText: c.altText.slice(0, 400), contents: c.contents }]);
}

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
  postback?: { data?: string };
  source?: { userId?: string };
}): Promise<void> {
  const lineUserId = ev.source?.userId;
  if (!lineUserId) return;

  if (ev.type === "unfollow") {
    await unlinkByLineUserId(lineUserId);
    return;
  }

  // Rich-menu buttons fire a postback like "cmd=my_tasks"; leave cards fire
  // "cmd=leave_approve&id=…" / "cmd=leave_reject&id=…".
  if (ev.type === "postback" && ev.replyToken) {
    const params = new URLSearchParams(ev.postback?.data ?? "");
    const cmd = params.get("cmd") ?? "";
    if (cmd === "leave_approve" || cmd === "leave_reject") {
      const id = params.get("id") ?? "";
      if (id) {
        const messages = await handleLeaveDecision(
          lineUserId,
          id,
          cmd === "leave_approve" ? "APPROVED" : "REJECTED"
        );
        if (messages.length) await replyToLine(ev.replyToken, messages);
      }
      return;
    }
    if (isBotCommand(cmd)) {
      const messages = await handleBotCommand(cmd, lineUserId);
      if (messages.length) await replyToLine(ev.replyToken, messages);
    }
    return;
  }

  if (ev.type === "follow") {
    if (ev.replyToken) {
      await replyCard(
        ev.replyToken,
        "👋 ยินดีต้อนรับสู่ DevPulse",
        "#0d9488",
        `บอทแจ้งเตือนงานของทีม\n\n${LINK_HELP}`
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
      await replyCard(
        ev.replyToken,
        "✅ เชื่อมต่อบัญชีสำเร็จ",
        "#16a34a",
        `สวัสดีคุณ${linked.name}\nจากนี้จะได้รับแจ้งเตือนงานส่วนตัวทาง LINE นี้ครับ\nพิมพ์ "เมนู" เพื่อดูคำสั่งทั้งหมด`
      );
      return;
    }
    // Not a valid code. If this LINE is already linked, treat the text as a
    // typed command (falling back to the help menu). Otherwise guide them to link.
    const already = await prisma.user.findFirst({
      where: { lineUserId },
      select: { id: true },
    });
    if (already) {
      // Interactive commands first ("เสร็จ <งาน>", "งานของ <ชื่อ>"), then keywords.
      const close = parseCloseCommand(text);
      const member = parseMemberCommand(text);
      const messages =
        close !== null
          ? await closeTaskByName(lineUserId, close)
          : member
            ? await memberTasks(lineUserId, member)
            : await handleBotCommand(matchTextCommand(text) ?? "help", lineUserId);
      if (messages.length) await replyToLine(ev.replyToken, messages);
    } else {
      await replyCard(
        ev.replyToken,
        "🔗 ยังไม่ได้เชื่อมต่อ",
        "#d97706",
        `ไม่พบรหัสนี้ หรือรหัสหมดอายุแล้ว\n\n${LINK_HELP}`
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
        postback?: { data?: string };
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
