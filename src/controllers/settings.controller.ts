import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { getLineQuota } from "../lib/line";
import { triggerSummary } from "../lib/scheduler";
import type {
  CreateHolidayInput,
  CreateLeaveTypeInput,
  UpdateHolidayInput,
  UpdateLeaveTypeInput,
  UpdateSettingsInput,
} from "../schemas/settings.schema";

const DEFAULT_SETTING = {
  teamName: "ทีมแพลตฟอร์ม",
  reportReminderTime: "16:30 น.",
};

/** Parse a YYYY-MM-DD (Bangkok) string to the UTC-midnight Date the calendar buckets on. */
function bangkokDayToUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/* ----------------------------- Team settings --------------------------- */

export async function getSettings(_req: Request, res: Response) {
  let setting = await prisma.teamSetting.findFirst();
  if (!setting) {
    setting = await prisma.teamSetting.create({ data: DEFAULT_SETTING });
  }
  // Surface LINE integration status so the settings UI can show connection state
  // (without exposing secrets — only whether it's enabled, a group is linked,
  // and this month's message quota/usage).
  const quota = await getLineQuota();
  res.json({
    setting,
    line: {
      enabled: env.LINE_ENABLED,
      groupConnected: !!setting.lineGroupId,
      quota,
    },
  });
}

/** POST /api/settings/line/test/:kind — fire a LINE summary now (manager/admin). */
export async function testLineSummary(req: Request, res: Response) {
  const k = req.params.kind;
  const kind =
    k === "leave"
      ? "leave"
      : k === "performance"
        ? "performance"
        : k === "highlight"
          ? "highlight"
          : k === "digest"
            ? "digest"
            : "report";
  const result = await triggerSummary(kind);
  res.json(result);
}

export async function updateSettings(req: Request, res: Response) {
  const data = req.body as UpdateSettingsInput;
  const existing = await prisma.teamSetting.findFirst();

  // When a daily summary's send time changes, or it's turned on, clear that
  // summary's per-day "last run" guard so the new schedule applies TODAY instead
  // of being blocked by an earlier run. Server-set only (not from user input).
  const extra: {
    lineReportSummaryLastRun?: null;
    lineLeaveSummaryLastRun?: null;
    lineWeeklyPerformanceLastRun?: null;
    lineWeeklyHighlightLastRun?: null;
    lineDailyDigestLastRun?: null;
  } = {};
  if (existing) {
    const reportRearmed =
      (data.lineDailyReportSummaryTime !== undefined &&
        data.lineDailyReportSummaryTime !== existing.lineDailyReportSummaryTime) ||
      (data.lineDailyReportSummary === true && !existing.lineDailyReportSummary);
    if (reportRearmed) extra.lineReportSummaryLastRun = null;

    const leaveRearmed =
      (data.lineDailyLeaveSummaryTime !== undefined &&
        data.lineDailyLeaveSummaryTime !== existing.lineDailyLeaveSummaryTime) ||
      (data.lineDailyLeaveSummary === true && !existing.lineDailyLeaveSummary);
    if (leaveRearmed) extra.lineLeaveSummaryLastRun = null;

    const perfRearmed =
      (data.lineWeeklyPerformanceTime !== undefined &&
        data.lineWeeklyPerformanceTime !== existing.lineWeeklyPerformanceTime) ||
      (data.lineWeeklyPerformance === true && !existing.lineWeeklyPerformance);
    if (perfRearmed) extra.lineWeeklyPerformanceLastRun = null;

    const highlightRearmed =
      (data.lineWeeklyHighlightTime !== undefined &&
        data.lineWeeklyHighlightTime !== existing.lineWeeklyHighlightTime) ||
      (data.lineWeeklyHighlight === true && !existing.lineWeeklyHighlight);
    if (highlightRearmed) extra.lineWeeklyHighlightLastRun = null;

    const digestRearmed =
      (data.lineDailyDigestTime !== undefined &&
        data.lineDailyDigestTime !== existing.lineDailyDigestTime) ||
      (data.lineDailyDigest === true && !existing.lineDailyDigest);
    if (digestRearmed) extra.lineDailyDigestLastRun = null;
  }

  const setting = existing
    ? await prisma.teamSetting.update({
        where: { id: existing.id },
        data: { ...data, ...extra },
      })
    : await prisma.teamSetting.create({ data: { ...DEFAULT_SETTING, ...data } });

  res.json({ setting });
}

/* --------------------------- Leave-type policies ----------------------- */

export async function listLeaveTypes(_req: Request, res: Response) {
  const leaveTypes = await prisma.leaveTypePolicy.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  res.json({ leaveTypes });
}

export async function createLeaveType(req: Request, res: Response) {
  const data = req.body as CreateLeaveTypeInput;
  const leaveType = await prisma.leaveTypePolicy.create({ data });
  res.status(201).json({ leaveType });
}

export async function updateLeaveType(req: Request, res: Response) {
  const data = req.body as UpdateLeaveTypeInput;
  const leaveType = await prisma.leaveTypePolicy.update({
    where: { id: req.params.id },
    data,
  });
  res.json({ leaveType });
}

/**
 * Archive (soft-delete) a leave type. The policy table has no FK from
 * historical leave requests, but we archive rather than hard-delete so the
 * configuration history is preserved and can be restored.
 */
export async function deleteLeaveType(req: Request, res: Response) {
  await prisma.leaveTypePolicy.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.status(204).send();
}

/* ----------------------------- Company holidays ------------------------ */

export async function listHolidays(_req: Request, res: Response) {
  const holidays = await prisma.companyHoliday.findMany({
    where: { isActive: true },
    orderBy: { date: "asc" },
  });
  res.json({ holidays });
}

export async function createHoliday(req: Request, res: Response) {
  const data = req.body as CreateHolidayInput;
  const holiday = await prisma.companyHoliday.create({
    data: {
      name: data.name,
      date: bangkokDayToUtc(data.date),
      description: data.description ?? "",
      type: data.type ?? "COMPANY",
      isActive: data.isActive ?? true,
    },
  });
  res.status(201).json({ holiday });
}

export async function updateHoliday(req: Request, res: Response) {
  const data = req.body as UpdateHolidayInput;
  const holiday = await prisma.companyHoliday.update({
    where: { id: req.params.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.date !== undefined ? { date: bangkokDayToUtc(data.date) } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
  res.json({ holiday });
}

export async function deleteHoliday(req: Request, res: Response) {
  await prisma.companyHoliday.delete({ where: { id: req.params.id } });
  res.status(204).send();
}

/* ------------------------------ Menu config ---------------------------- */

function parseMenu(raw: string | undefined): unknown[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

/** Sidebar menu customization (display only). Readable by any authed user so
 * the sidebar can render it; it never grants page access (RBAC is separate). */
export async function getMenu(_req: Request, res: Response) {
  const setting = await prisma.teamSetting.findFirst();
  res.json({ menu: parseMenu(setting?.menuConfig) });
}

export async function updateMenu(req: Request, res: Response) {
  const { menu } = req.body as { menu: unknown[] };
  const existing = await prisma.teamSetting.findFirst();
  const json = JSON.stringify(menu);
  const setting = existing
    ? await prisma.teamSetting.update({ where: { id: existing.id }, data: { menuConfig: json } })
    : await prisma.teamSetting.create({ data: { ...DEFAULT_SETTING, menuConfig: json } });
  res.json({ menu: parseMenu(setting.menuConfig) });
}

export async function resetMenu(_req: Request, res: Response) {
  const existing = await prisma.teamSetting.findFirst();
  if (existing) {
    await prisma.teamSetting.update({ where: { id: existing.id }, data: { menuConfig: "" } });
  }
  res.json({ menu: [] });
}
