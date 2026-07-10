import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type {
  CreateLeaveTypeInput,
  UpdateLeaveTypeInput,
  UpdateSettingsInput,
} from "../schemas/settings.schema";

const DEFAULT_SETTING = {
  teamName: "ทีมแพลตฟอร์ม",
  reportReminderTime: "16:30 น.",
};

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

export async function deleteLeaveType(req: Request, res: Response) {
  await prisma.leaveTypePolicy.delete({ where: { id: req.params.id } });
  res.status(204).send();
}
