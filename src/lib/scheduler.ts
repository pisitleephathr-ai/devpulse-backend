import { env } from "./env";
import { prisma } from "./prisma";
import { appBaseUrl, pushFlexToLineGroup } from "./line";
import {
  leaveTodayFlex,
  reportSummaryFlex,
  type LeaveTodayEntry,
} from "./line-messages";

/**
 * Lightweight, dependency-free daily scheduler for the two timed LINE summaries
 * ("who's on leave today" + "daily report summary"). A single 60s interval
 * checks the team's configured send times against the current Bangkok clock and
 * fires each summary at most once per day.
 *
 * Robustness:
 *  - Times/toggles are read fresh from TeamSetting every tick, so changing them
 *    in Settings takes effect immediately (no restart).
 *  - A per-summary YYYY-MM-DD "last run" guard (persisted on TeamSetting) means a
 *    server restart never double-sends, and a summary missed at its exact minute
 *    still fires on the next tick that is past its time the same day.
 *  - Only fires on configured working days. Best-effort — never throws.
 */

/** Bangkok "now" as a Date shifted into UTC+7 wall-clock (for slice math). */
function bangkokNow(): Date {
  return new Date(Date.now() + 7 * 3_600_000);
}
/** Today (YYYY-MM-DD) in Asia/Bangkok. */
function bangkokToday(): string {
  return bangkokNow().toISOString().slice(0, 10);
}
/** Current wall-clock "HH:mm" in Asia/Bangkok. */
function bangkokHM(): string {
  return bangkokNow().toISOString().slice(11, 16);
}
/** Weekday number (0=Sun … 6=Sat) in Asia/Bangkok. */
function bangkokWeekday(): number {
  return bangkokNow().getUTCDay();
}
/** UTC range covering a Bangkok calendar day. */
function dayRange(dateStr: string) {
  const gte = new Date(`${dateStr}T00:00:00.000Z`);
  const lt = new Date(gte.getTime() + 24 * 3_600_000);
  return { gte, lt };
}
/** Normalize a stored time to "HH:mm" (defensive against stray input). */
function hm(value: string | null | undefined, fallback: string): string {
  const m = (value ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** Build + push the "who's on leave today" card (skips when nobody is out). */
async function sendLeaveSummary(today: string): Promise<void> {
  const { gte, lt } = dayRange(today);
  // Approved leaves whose span covers today.
  const leaves = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", startDate: { lt }, endDate: { gte } },
    select: {
      type: true,
      days: true,
      halfDayPeriod: true,
      user: { select: { name: true } },
    },
    orderBy: { user: { name: "asc" } },
  });
  if (!leaves.length) return; // nobody on leave — save the quota
  const entries: LeaveTodayEntry[] = leaves.map((l) => ({
    name: l.user.name,
    type: l.type,
    days: l.days,
    half: l.halfDayPeriod,
  }));
  const base = appBaseUrl();
  const card = leaveTodayFlex(gte, entries, base ? `${base}/calendar` : undefined);
  await pushFlexToLineGroup(card.altText, card.contents);
}

/** Build + push the daily-report submission summary (skips when no one is expected). */
async function sendReportSummary(today: string): Promise<void> {
  const { gte, lt } = dayRange(today);
  const [required, reports, leaves] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, requiresDailyReport: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.dailyReport.findMany({
      where: { date: { gte, lt } },
      select: { authorId: true },
    }),
    // People on approved leave covering today aren't expected to report.
    prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lt }, endDate: { gte } },
      select: { userId: true },
    }),
  ]);
  const onLeave = new Set(leaves.map((l) => l.userId));
  const expected = required.filter((u) => !onLeave.has(u.id));
  if (!expected.length) return; // nobody expected today (all on leave / none required)
  const submitted = new Set(reports.map((r) => r.authorId));
  const missing = expected.filter((u) => !submitted.has(u.id));
  const base = appBaseUrl();
  const card = reportSummaryFlex(
    gte,
    {
      submitted: expected.length - missing.length,
      total: expected.length,
      missingNames: missing.map((u) => u.name),
    },
    base ? `${base}/standup` : undefined
  );
  await pushFlexToLineGroup(card.altText, card.contents);
}

/** Whether today (Bangkok) is an active company holiday. */
async function isCompanyHoliday(today: string): Promise<boolean> {
  const { gte, lt } = dayRange(today);
  const h = await prisma.companyHoliday.findFirst({
    where: { isActive: true, date: { gte, lt } },
    select: { id: true },
  });
  return !!h;
}

/**
 * One scheduler pass. Marks a summary's "last run" BEFORE sending so an overlong
 * send can't cause the next tick to re-fire it. Each summary is isolated so one
 * failing never blocks the other.
 */
async function tick(): Promise<void> {
  const setting = await prisma.teamSetting.findFirst();
  if (!setting) return;

  const today = bangkokToday();
  const now = bangkokHM();
  const workingDays = new Set(
    setting.workingDays.split(",").filter(Boolean).map(Number)
  );
  if (!workingDays.has(bangkokWeekday())) return; // skip non-working days

  const leaveDue =
    setting.lineDailyLeaveSummary &&
    setting.lineLeaveSummaryLastRun !== today &&
    now >= hm(setting.lineDailyLeaveSummaryTime, "09:00");
  const reportDue =
    setting.lineDailyReportSummary &&
    setting.lineReportSummaryLastRun !== today &&
    now >= hm(setting.lineDailyReportSummaryTime, "18:00");
  if (!leaveDue && !reportDue) return;

  // A company holiday is a day off — send neither summary.
  if (await isCompanyHoliday(today)) return;

  if (leaveDue) {
    await prisma.teamSetting.update({
      where: { id: setting.id },
      data: { lineLeaveSummaryLastRun: today },
    });
    await sendLeaveSummary(today).catch((e) =>
      console.warn("[scheduler] leave summary failed:", e)
    );
  }

  if (reportDue) {
    await prisma.teamSetting.update({
      where: { id: setting.id },
      data: { lineReportSummaryLastRun: today },
    });
    await sendReportSummary(today).catch((e) =>
      console.warn("[scheduler] report summary failed:", e)
    );
  }
}

/** Arm the daily-summary scheduler. No-op unless LINE is configured. */
export function startScheduler(): void {
  if (!env.LINE_ENABLED || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.log("[scheduler] LINE not configured — daily summaries off");
    return;
  }
  const run = () =>
    tick().catch((e) => console.warn("[scheduler] tick error:", e));
  setInterval(run, 60_000);
  run(); // also evaluate once at boot (covers restarts past a send time)
  console.log("[scheduler] daily LINE summaries armed");
}
