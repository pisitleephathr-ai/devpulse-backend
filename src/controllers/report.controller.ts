import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { logActivity } from "../lib/activity";
import { isTeamManager } from "../lib/authz";
import { workdayInfo } from "../lib/workday";
import { getBangkokDateString } from "../lib/date";
import { AppError } from "../middleware/error";
import type {
  CreateReportInput,
  ReportQuery,
  UpdateReportInput,
} from "../schemas/report.schema";

const include = {
  author: { select: userMiniSelect },
  project: { select: { id: true, name: true, code: true, color: true } },
  relatedTasks: {
    include: {
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          project: { select: { id: true, code: true, color: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.DailyReportInclude;

/** Flatten the join rows into a plain `relatedTasks` array for the client. */
function serialize<T extends { relatedTasks: { task: unknown }[] }>(report: T) {
  const { relatedTasks, ...rest } = report;
  return { ...rest, relatedTasks: relatedTasks.map((rt) => rt.task) };
}

/**
 * Validate optional related task ids. Reports may reference any accessible
 * task (not restricted to the report's project). Returns the de-duplicated
 * id list; throws 400 if any id does not exist.
 */
async function resolveRelatedTaskIds(
  taskIds: string[] | undefined
): Promise<string[]> {
  const ids = [...new Set((taskIds ?? []).filter(Boolean))];
  if (ids.length === 0) return ids;
  const found = await prisma.task.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length)
    throw new AppError(400, "มีงานที่เลือกไม่ถูกต้อง");
  return ids;
}

function summarize(did: string) {
  const s = did.trim().replace(/\s+/g, " ");
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
}

/** True when the acting user owns the record or can manage the team. */
function canManage(req: Request, ownerId: string) {
  return req.user!.id === ownerId || isTeamManager(req);
}

/**
 * GET /api/reports/workday?date=YYYY-MM-DD — whether a Bangkok day is a working
 * day (+ the holiday, if any). Lets the reports page suppress the "you haven't
 * submitted today" nudge on weekends/holidays. Any authenticated user.
 */
export async function workdayStatus(req: Request, res: Response) {
  const dateStr = (req.query.date as string) || getBangkokDateString();
  const info = await workdayInfo(dateStr);
  res.json({ date: dateStr, ...info });
}

export async function listReports(req: Request, res: Response) {
  const q = req.query as unknown as ReportQuery;
  const where: Prisma.DailyReportWhereInput = {
    authorId: q.authorId,
    projectId: q.projectId,
    status: q.status,
  };
  const orderBy: Prisma.DailyReportOrderByWithRelationInput[] = [
    { date: "desc" },
    { createdAt: "desc" },
  ];

  // Paginated mode (opt-in via `limit`): return a page + metadata.
  if (q.limit) {
    const limit = q.limit;
    const page = q.page ?? 1;
    const [rows, total] = await Promise.all([
      prisma.dailyReport.findMany({
        where,
        include,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.dailyReport.count({ where }),
    ]);
    res.json({
      reports: rows.map(serialize),
      total,
      page,
      limit,
      hasMore: page * limit < total,
    });
    return;
  }

  // Unpaginated (backward-compatible) — return the full list.
  const reports = await prisma.dailyReport.findMany({ where, include, orderBy });
  res.json({ reports: reports.map(serialize) });
}

export async function getReport(req: Request, res: Response) {
  const report = await prisma.dailyReport.findUnique({
    where: { id: req.params.id },
    include,
  });
  if (!report) throw new AppError(404, "ไม่พบรายงาน");
  res.json({ report: serialize(report) });
}

export async function createReport(req: Request, res: Response) {
  const data = req.body as CreateReportInput;

  // Only managers/admins may set a different author.
  const authorId =
    data.authorId && isTeamManager(req) ? data.authorId : req.user!.id;

  const relatedTaskIds = await resolveRelatedTaskIds(data.relatedTaskIds);

  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.dailyReport.create({
    data: {
      authorId,
      projectId: data.projectId,
      date: data.date ?? new Date(),
      summary: data.summary?.trim() || summarize(data.did),
      did: data.did.trim(),
      blockers: data.blockers?.trim() ?? "",
      plan: data.plan?.trim() ?? "",
      status: data.status ?? "SUBMITTED",
      relatedTasks: relatedTaskIds.length
        ? {
            create: relatedTaskIds.map((taskId) => ({
              taskId,
              createdById: req.user!.id,
            })),
          }
        : undefined,
    },
    include,
    });
    // Audit log shares the report's transaction (both commit or neither).
    await logActivity(
      {
        userId: req.user!.id,
        action: "report.create",
        message:
          created.status === "DRAFT"
            ? `บันทึกฉบับร่างรายงานของ ${created.author.name}`
            : `${created.author.name} ส่งรายงานประจำวันแล้ว`,
        entityType: "report",
        entityId: created.id,
      },
      tx
    );
    return created;
  });

  res.status(201).json({ report: serialize(report) });
}

export async function updateReport(req: Request, res: Response) {
  const id = req.params.id;
  const existing = await prisma.dailyReport.findUnique({
    where: { id },
    select: { authorId: true },
  });
  if (!existing) throw new AppError(404, "ไม่พบรายงาน");
  if (!canManage(req, existing.authorId))
    throw new AppError(403, "ไม่มีสิทธิ์แก้ไขรายงานนี้");

  const { relatedTaskIds, ...scalar } = req.body as UpdateReportInput;
  // Only touch links when the field is explicitly present in the payload.
  const nextTaskIds =
    relatedTaskIds !== undefined
      ? await resolveRelatedTaskIds(relatedTaskIds)
      : undefined;

  const report = await prisma.$transaction(async (tx) => {
    await tx.dailyReport.update({ where: { id }, data: scalar });
    if (nextTaskIds !== undefined) {
      await tx.dailyReportRelatedTask.deleteMany({ where: { reportId: id } });
      if (nextTaskIds.length)
        await tx.dailyReportRelatedTask.createMany({
          data: nextTaskIds.map((taskId) => ({
            reportId: id,
            taskId,
            createdById: req.user!.id,
          })),
        });
    }
    return tx.dailyReport.findUnique({ where: { id }, include });
  });

  await logActivity({
    userId: req.user!.id,
    action: "report.update",
    message: `แก้ไขรายงานของ ${report!.author.name}`,
    entityType: "report",
    entityId: report!.id,
  });

  res.json({ report: serialize(report!) });
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
