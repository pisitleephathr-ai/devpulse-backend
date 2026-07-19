import { env } from "./env";
import { prisma } from "./prisma";
import {
  appBaseUrl,
  pushFlexToLineGroup,
  pushToUsersWithPref,
  lineDeliveryStatus,
} from "./line";
import {
  getBangkokDateString,
  getBangkokHM,
  getBangkokWeekday,
  bangkokDateToUtcRange,
} from "./date";
import {
  leaveTodayFlex,
  reportSummaryFlex,
  performanceSummaryFlex,
  type LeaveTodayEntry,
  type ReportEntry,
  type PerformanceEntry,
} from "./line-messages";
import { onTimeStatsByUser } from "./ontime";

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

// Bangkok date/time helpers now come from src/lib/date.ts (single source).
const bangkokToday = getBangkokDateString;
const bangkokHM = getBangkokHM;
const bangkokWeekday = getBangkokWeekday;
const dayRange = bangkokDateToUtcRange;

/** Normalize a stored time to "HH:mm" (defensive against stray input). */
function hm(value: string | null | undefined, fallback: string): string {
  const m = (value ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

type SendResult = { pushed: boolean; reason?: string };

/** Build + push the "who's on leave today" card (skips when nobody is out). */
async function sendLeaveSummary(today: string): Promise<SendResult> {
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
  if (!leaves.length) return { pushed: false, reason: "วันนี้ไม่มีใครลา" };
  const entries: LeaveTodayEntry[] = leaves.map((l) => ({
    name: l.user.name,
    type: l.type,
    days: l.days,
    half: l.halfDayPeriod,
  }));
  const base = appBaseUrl();
  const card = leaveTodayFlex(gte, entries, base ? `${base}/calendar` : undefined);
  await pushFlexToLineGroup(card.altText, card.contents);
  return { pushed: true };
}

/** Build + push the daily-report submission summary (skips when no one is expected). */
async function sendReportSummary(today: string): Promise<SendResult> {
  const { gte, lt } = dayRange(today);
  const [required, reports, leaves] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, requiresDailyReport: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.dailyReport.findMany({
      where: { date: { gte, lt } },
      select: { authorId: true, summary: true, did: true, blockers: true },
      orderBy: { createdAt: "asc" },
    }),
    // People on approved leave covering today aren't expected to report.
    prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lt }, endDate: { gte } },
      select: { userId: true },
    }),
  ]);
  const onLeave = new Set(leaves.map((l) => l.userId));
  const expected = required.filter((u) => !onLeave.has(u.id));
  if (!expected.length) {
    return { pushed: false, reason: "วันนี้ไม่มีผู้ที่ต้องส่งรายงาน (หรือทุกคนลา)" };
  }

  // One entry per expected author who submitted (first report wins; note blockers).
  const byAuthor = new Map<string, { summary: string; did: string; blocked: boolean }>();
  for (const r of reports) {
    if (byAuthor.has(r.authorId)) continue;
    byAuthor.set(r.authorId, {
      summary: r.summary,
      did: r.did,
      blocked: r.blockers.trim().length > 0,
    });
  }
  const submitted: ReportEntry[] = [];
  const missingNames: string[] = [];
  const missingIds: string[] = [];
  for (const u of expected) {
    const rep = byAuthor.get(u.id);
    if (rep) {
      submitted.push({
        name: u.name,
        detail: rep.summary.trim() || rep.did.trim(),
        blocked: rep.blocked,
      });
    } else {
      missingNames.push(u.name);
      missingIds.push(u.id);
    }
  }

  const base = appBaseUrl();
  const card = reportSummaryFlex(
    gte,
    { total: expected.length, submitted, missingNames },
    base ? `${base}/reports` : undefined
  );
  await pushFlexToLineGroup(card.altText, card.contents);

  // Auto personal nudge to those who still haven't submitted (per-user pref).
  if (missingIds.length) {
    await pushToUsersWithPref(missingIds, "reportReminder", [
      {
        type: "text",
        text:
          "⏰ อย่าลืมส่งรายงานประจำวันก่อนเลิกงานนะครับ" +
          (base ? `\nส่งได้ที่: ${base}/reports` : ""),
      },
    ]);
  }
  return { pushed: true };
}

/** Build + push the weekly team performance (on-time ranking) card. */
async function sendPerformanceSummary(): Promise<SendResult> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const stats = await onTimeStatsByUser(since);
  if (!stats.size) return { pushed: false, reason: "สัปดาห์นี้ยังไม่มีงานที่ปิดพร้อมกำหนดส่ง" };

  const users = await prisma.user.findMany({
    where: { id: { in: [...stats.keys()] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const entries: PerformanceEntry[] = [...stats.values()]
    .map((s) => ({
      name: nameById.get(s.userId) ?? "—",
      closed: s.closed,
      onTime: s.onTime,
      late: s.late,
      rate: s.rate,
    }))
    .sort((a, b) => b.rate - a.rate || b.closed - a.closed);

  const base = appBaseUrl();
  const card = performanceSummaryFlex(
    "7 วันล่าสุด",
    entries,
    base ? `${base}/dashboard` : undefined
  );
  await pushFlexToLineGroup(card.altText, card.contents);
  return { pushed: true };
}

/**
 * Manually fire a summary now, bypassing the schedule/last-run/working-day
 * gates (used by the "send test" button). Still respects LINE config + group
 * connection so the caller gets a clear reason when delivery isn't possible.
 */
export async function triggerSummary(
  kind: "leave" | "report" | "performance"
): Promise<{ sent: boolean; reason?: string }> {
  const status = await lineDeliveryStatus();
  if (!status.ready) return { sent: false, reason: status.reason };
  const today = bangkokToday();
  const r =
    kind === "leave"
      ? await sendLeaveSummary(today)
      : kind === "report"
        ? await sendReportSummary(today)
        : await sendPerformanceSummary();
  return { sent: r.pushed, reason: r.reason };
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
  // Weekly performance summary: Mondays only (Bangkok weekday 1).
  const performanceDue =
    setting.lineWeeklyPerformance &&
    bangkokWeekday() === 1 &&
    setting.lineWeeklyPerformanceLastRun !== today &&
    now >= hm(setting.lineWeeklyPerformanceTime, "09:00");
  if (!leaveDue && !reportDue && !performanceDue) return;

  // A company holiday is a day off — send nothing.
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

  if (performanceDue) {
    await prisma.teamSetting.update({
      where: { id: setting.id },
      data: { lineWeeklyPerformanceLastRun: today },
    });
    await sendPerformanceSummary().catch((e) =>
      console.warn("[scheduler] performance summary failed:", e)
    );
  }
}

/**
 * Run one schedule-aware pass on demand — used by the cron endpoint so an
 * external scheduler can drive the summaries even when the server would
 * otherwise be idle/asleep. Respects the configured time, working days,
 * holidays, and per-day dedup exactly like the internal timer.
 */
export async function runScheduledSummaries(): Promise<void> {
  await tick();
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
