import type { Request, Response } from "express";
import { env } from "../lib/env";
import { runScheduledSummaries } from "../lib/scheduler";
import { runAttachmentCleanup } from "../lib/attachment-cleanup";
import { publishRichMenu } from "../lib/line-richmenu";

/** Pull the caller's secret from a Bearer token, header, or query param. */
function providedSecret(req: Request): string | undefined {
  const auth = req.header("authorization");
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const header = req.header("x-cron-secret");
  if (header) return header.trim();
  const q = req.query.secret;
  return typeof q === "string" ? q.trim() : undefined;
}

/**
 * External-cron entrypoint. Runs one schedule-aware summary pass so an external
 * scheduler (cron-job.org, GitHub Actions, etc.) can drive the daily LINE
 * summaries even when the server would otherwise be idle/asleep. Gated by
 * CRON_SECRET (no user session). Safe to call frequently — the per-day dedup
 * guard means each summary still fires at most once.
 */
export async function cronLineSummaries(req: Request, res: Response) {
  if (!env.CRON_SECRET) {
    res.status(503).json({ ok: false, error: "CRON_SECRET not configured" });
    return;
  }
  if (providedSecret(req) !== env.CRON_SECRET) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  await runScheduledSummaries();
  res.json({ ok: true });
}

/**
 * External-cron entrypoint for attachment cleanup — orphan Cloudinary sweep +
 * failed-delete retry. Gated by CRON_SECRET; safe to call frequently (each unit
 * of work is idempotent). Returns the cleanup summary for observability.
 */
export async function cronAttachmentCleanup(req: Request, res: Response) {
  if (!env.CRON_SECRET) {
    res.status(503).json({ ok: false, error: "CRON_SECRET not configured" });
    return;
  }
  if (providedSecret(req) !== env.CRON_SECRET) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  const summary = await runAttachmentCleanup();
  res.json({ ok: true, summary });
}

/**
 * Server-side trigger to (re)publish the LINE rich menu. Runs inside the
 * deployed environment so it can reach api-data.line.me (the image-upload host
 * that may be blocked from a developer's machine). Gated by CRON_SECRET; call
 * once after deploy. Auto-generates the menu image via Cloudinary.
 */
export async function cronSetupRichMenu(req: Request, res: Response) {
  if (!env.CRON_SECRET) {
    res.status(503).json({ ok: false, error: "CRON_SECRET not configured" });
    return;
  }
  if (providedSecret(req) !== env.CRON_SECRET) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  const result = await publishRichMenu();
  res.json({ ok: true, ...result });
}
