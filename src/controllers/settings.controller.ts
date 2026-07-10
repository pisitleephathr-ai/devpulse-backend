import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
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
  res.json({ setting });
}

export async function updateSettings(req: Request, res: Response) {
  const data = req.body as UpdateSettingsInput;
  const existing = await prisma.teamSetting.findFirst();

  const setting = existing
    ? await prisma.teamSetting.update({ where: { id: existing.id }, data })
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
