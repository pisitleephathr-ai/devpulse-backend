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
  ReportItemInput,
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
  items: {
    include: {
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          project: { select: { id: true, code: true, color: true, name: true } },
        },
      },
    },
    orderBy: { order: "asc" as const },
  },
} satisfies Prisma.DailyReportInclude;

/** Flatten the join rows into a plain `relatedTasks` array for the client. */
function serialize<T extends { relatedTasks: { task: unknown }[] }>(report: T) {
  const { relatedTasks, ...rest } = report;
  return { ...rest, relatedTasks: relatedTasks.map((rt) => rt.task) };
}

type NormItem = {
  taskId: string | null;
  title: string;
  progress: number;
  note: string;
  order: number;
};

/** Validate + normalize report items (clamp progress, trim, verify task ids). */
async function resolveItems(
  items: ReportItemInput[]
): Promise<NormItem[]> {
  const norm: NormItem[] = items.map((it, i) => ({
    taskId: it.taskId ?? null,
    title: it.title.trim(),
    progress: Math.max(0, Math.min(100, Math.round(it.progress ?? 0))),
    note: (it.note ?? "").trim(),
    order: i,
  }));
  const taskIds = [...new Set(norm.map((n) => n.taskId).filter((x): x is string => !!x))];
  if (taskIds.length) {
    const found = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true },
    });
    if (found.length !== taskIds.length)
      throw new AppError(400, "มีงานที่เลือกไม่ถูกต้อง");
  }
  return norm;
}

/**
 * Derive the legacy free-text fields (did/plan/blockers/summary) from items so
 * every existing consumer — standup, dashboard blockers, the LINE summary, and
 * full-text search — keeps working without change.
 */
function deriveFromItems(items: NormItem[]): {
  did: string;
  plan: string;
  blockers: string;
  summary: string;
} {
  const did = items.map((i) => `${i.title} — ${i.progress}%`).join("\n");
  const blockers = items
    .filter((i) => i.note.length > 0)
    .map((i) => `${i.title}: ${i.note}`)
    .join("\n");
  const plan = items
    .filter((i) => i.progress < 100)
    .map((i) => `${i.title} (${i.progress}%)`)
    .join("\n");
  const done = items.filter((i) => i.progress >= 100).length;
  const summary = `${done}/${items.length} งานเสร็จวันนี้`;
  return { did, plan, blockers, summary };
}

/** Distinct board-task ids referenced by items (for the relatedTasks mirror). */
function itemTaskIds(items: NormItem[]): string[] {
  return [...new Set(items.map((i) => i.taskId).filter((x): x is string => !!x))];
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

  // New model: content comes from `items`. Derive the legacy text fields + mirror
  // the item task links into relatedTasks. Fall back to legacy text if no items.
  const items = data.items?.length ? await resolveItems(data.items) : null;
  const derived = items ? deriveFromItems(items) : null;
  const relatedTaskIds = data.relatedTaskIds?.length
    ? await resolveRelatedTaskIds(data.relatedTaskIds)
    : items
      ? itemTaskIds(items)
      : [];

  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.dailyReport.create({
    data: {
      authorId,
      projectId: data.projectId,
      date: data.date ?? new Date(),
      summary: derived?.summary || data.summary?.trim() || summarize(data.did ?? ""),
      did: derived?.did ?? (data.did?.trim() ?? ""),
      blockers: derived?.blockers ?? (data.blockers?.trim() ?? ""),
      plan: derived?.plan ?? (data.plan?.trim() ?? ""),
      status: data.status ?? "SUBMITTED",
      relatedTasks: relatedTaskIds.length
        ? {
            create: relatedTaskIds.map((taskId) => ({
              taskId,
              createdById: req.user!.id,
            })),
          }
        : undefined,
      items: items
        ? {
            create: items.map((i) => ({
              taskId: i.taskId,
              title: i.title,
              progress: i.progress,
              note: i.note,
              order: i.order,
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

  const { relatedTaskIds, items, ...scalar } = req.body as UpdateReportInput;

  // When items are provided, they become the content: re-derive the text fields
  // and mirror the item task links into relatedTasks (unless explicit ids given).
  const resolvedItems =
    items !== undefined ? await resolveItems(items) : undefined;
  const derived = resolvedItems ? deriveFromItems(resolvedItems) : undefined;
  const scalarData = {
    ...scalar,
    ...(derived
      ? {
          did: derived.did,
          plan: derived.plan,
          blockers: derived.blockers,
          summary: derived.summary,
        }
      : {}),
  };

  // Only touch links when explicitly given, else mirror from items if provided.
  const nextTaskIds =
    relatedTaskIds !== undefined
      ? await resolveRelatedTaskIds(relatedTaskIds)
      : resolvedItems
        ? itemTaskIds(resolvedItems)
        : undefined;

  const report = await prisma.$transaction(async (tx) => {
    await tx.dailyReport.update({ where: { id }, data: scalarData });
    if (resolvedItems !== undefined) {
      await tx.dailyReportItem.deleteMany({ where: { reportId: id } });
      if (resolvedItems.length)
        await tx.dailyReportItem.createMany({
          data: resolvedItems.map((i) => ({
            reportId: id,
            taskId: i.taskId,
            title: i.title,
            progress: i.progress,
            note: i.note,
            order: i.order,
          })),
        });
    }
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
