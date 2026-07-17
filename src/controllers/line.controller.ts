import type { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";

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

/**
 * LINE Messaging API webhook. Verifies the signature over the RAW body, then
 * auto-captures the group id from any group-sourced event (so admins never have
 * to hunt for it). Mounted with express.raw() BEFORE express.json() so req.body
 * is the raw Buffer. Always acknowledges with 200 (except a bad signature) —
 * a webhook must never fail loudly.
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
        source?: { type?: string; groupId?: string };
      }>;
    };
    for (const ev of body.events ?? []) {
      const gid = ev.source?.type === "group" ? ev.source.groupId : undefined;
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
    }
    res.status(200).end();
  } catch {
    res.status(200).end();
  }
}
