import crypto from "crypto";
import { prisma } from "./prisma";
import { hashPassword } from "./password";

/** How long a reset link stays valid. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Generate a high-entropy, URL-safe raw token (only ever sent in the email). */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex"); // 256 bits
}

/** SHA-256 hex of a raw token — what we persist, so a DB leak isn't replayable. */
export function hashResetToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Issue a fresh reset token for a user. Any prior tokens for that user are
 * dropped first, so only the latest link works (a new request invalidates old
 * ones). Returns the RAW token (to embed in the email link) and its expiry.
 */
export async function issueResetToken(
  userId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId } }),
    prisma.passwordResetToken.create({
      data: { tokenHash: hashResetToken(token), userId, expiresAt },
    }),
  ]);
  return { token, expiresAt };
}

/**
 * Consume a raw reset token and set the user's new password, atomically. The
 * token must exist, be unexpired, and unused. On success the token (and any
 * siblings for that user) is deleted so it can't be replayed. Returns the
 * affected user's id + email, or null when the token is invalid/expired/used.
 */
export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string
): Promise<{ id: string; email: string } | null> {
  const tokenHash = hashResetToken(rawToken.trim());
  const passwordHash = await hashPassword(newPassword);

  return prisma.$transaction(async (tx) => {
    const entry = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!entry || entry.usedAt || entry.expiresAt.getTime() < Date.now()) {
      return null;
    }

    const user = await tx.user.update({
      where: { id: entry.userId },
      data: { password: passwordHash },
      select: { id: true, email: true },
    });

    // Single-use: drop this token and any other outstanding ones for the user.
    await tx.passwordResetToken.deleteMany({ where: { userId: entry.userId } });
    return user;
  });
}
