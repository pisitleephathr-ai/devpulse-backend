import crypto from "crypto";
import { prisma } from "./prisma";

/** How long a generated link code stays valid. */
export const LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Unambiguous code alphabet — no 0/O, 1/I/L to avoid mis-typing in a LINE chat.
 * 6 chars over a 32-symbol alphabet ≈ 1e9 combinations; codes are also single-use
 * and short-lived, so guessing is impractical.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

/** Generate a random, human-friendly uppercase link code. */
export function generateLinkCode(): string {
  const bytes = crypto.randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * Issue (or replace) the active link code for a user. One code per user — a
 * regenerate overwrites the previous one. Returns the code + its expiry.
 */
export async function issueLinkCode(
  userId: string
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
  // Retry on the (astronomically unlikely) event of a code PK collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLinkCode();
    try {
      await prisma.lineLinkCode.upsert({
        where: { userId },
        create: { code, userId, expiresAt },
        update: { code, expiresAt, createdAt: new Date() },
      });
      return { code, expiresAt };
    } catch (err) {
      // Unique collision on `code` (PK) — try a fresh one. Rethrow anything else.
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("could not allocate a unique link code");
}

/**
 * Consume a code sent by a user in the LINE chat and bind their LINE user id.
 * On success returns the now-linked user; returns null when the code is unknown
 * or expired. Runs in a transaction and clears the LINE id from any OTHER user
 * that happens to hold it (re-linking a LINE account to a new person), since
 * `User.lineUserId` is unique.
 */
export async function linkByCode(
  rawCode: string,
  lineUserId: string
): Promise<{ id: string; name: string } | null> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;

  return prisma.$transaction(async (tx) => {
    const entry = await tx.lineLinkCode.findUnique({ where: { code } });
    if (!entry || entry.expiresAt.getTime() < Date.now()) return null;

    // Free the LINE id from any other user first (unique constraint).
    await tx.user.updateMany({
      where: { lineUserId, NOT: { id: entry.userId } },
      data: { lineUserId: null, lineLinkedAt: null },
    });

    const user = await tx.user.update({
      where: { id: entry.userId },
      data: { lineUserId, lineLinkedAt: new Date() },
      select: { id: true, name: true },
    });

    // Consume the code so it can't be replayed.
    await tx.lineLinkCode.delete({ where: { code } });
    return user;
  });
}

/** Unlink whichever user currently holds this LINE id (e.g. on unfollow/block). */
export async function unlinkByLineUserId(lineUserId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { lineUserId },
    data: { lineUserId: null, lineLinkedAt: null },
  });
}
