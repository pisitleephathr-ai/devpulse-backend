import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { AppError } from "../middleware/error";
import type {
  CreateReportInput,
  ReportQuery,
  UpdateReportInput,
} from "../schemas/report.schema";

const include = {
  author: { select: userMiniSelect },
  project: { select: { id: true, name: true, code: true, color: true } },
};

function summarize(did: string) {
  const s = did.trim().replace(/\s+/g, " ");
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
}

/** True when the acting user owns the record or is a manager/admin. */
function canManage(req: Request, ownerId: string) {
  return (
    req.user!.id === ownerId ||
    req.user!.role === "MANAGER" ||
    req.user!.role === "ADMIN"
  );
}

export async function listReports(req: Request, res: Response) {
  const q = req.query as unknown as ReportQuery;
  const where: Prisma.DailyReportWhereInput = {
    authorId: q.authorId,
    projectId: q.projectId,
    status: q.status,
  };

  const reports = await prisma.dailyReport.findMany({
    where,
    include,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  res.json({ reports });
}

export async function getReport(req: Request, res: Response) {
  const report = await prisma.dailyReport.findUnique({
    where: { id: req.params.id },
    include,
  });
  if (!report) throw new AppError(404, "ไม่พบรายงาน");
  res.json({ report });
}

export async function createReport(req: Request, res: Response) {
  const data = req.body as CreateReportInput;

  // Only managers/admins may set a different author.
  const authorId =
    data.authorId &&
    (req.user!.role === "MANAGER" || req.user!.role === "ADMIN")
      ? data.authorId
      : req.user!.id;

  const report = await prisma.dailyReport.create({
    data: {
      authorId,
      projectId: data.projectId,
      date: data.date ?? new Date(),
      summary: data.summary?.trim() || summarize(data.did),
      did: data.did.trim(),
      blockers: data.blockers?.trim() ?? "",
      plan: data.plan?.trim() ?? "",
      status: data.status ?? "SUBMITTED",
    },
    include,
  });

  await logActivity({
    userId: req.user!.id,
    action: "report.create",
    message:
      report.status === "DRAFT"
        ? `บันทึกฉบับร่างรายงานของ ${report.author.name}`
        : `${report.author.name} ส่งรายงานประจำวันแล้ว`,
    entityType: "report",
    entityId: report.id,
  });

  res.status(201).json({ report });
}

export async function updateReport(req: Request, res: Response) {
  const existing = await prisma.dailyReport.findUnique({
    where: { id: req.params.id },
    select: { authorId: true },
  });
  if (!existing) throw new AppError(404, "ไม่พบรายงาน");
  if (!canManage(req, existing.authorId))
    throw new AppError(403, "ไม่มีสิทธิ์แก้ไขรายงานนี้");

  const report = await prisma.dailyReport.update({
    where: { id: req.params.id },
    data: req.body as UpdateReportInput,
    include,
  });
  res.json({ report });
}

export async function deleteReport(req: Request, res: Response) {
  const existing = await prisma.dailyReport.findUnique({
    where: { id: req.params.id },
    select: { authorId: true },
  });
  if (!existing) throw new AppError(404, "ไม่พบรายงาน");
  if (!canManage(req, existing.authorId))
    throw new AppError(403, "ไม่มีสิทธิ์ลบรายงานนี้");

  await prisma.dailyReport.delete({ where: { id: req.params.id } });
  res.status(204).send();
}
