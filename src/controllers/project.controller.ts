import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logActivity } from "../lib/activity";
import { AppError } from "../middleware/error";
import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "../schemas/project.schema";

/** Attach task/report/member stats to a set of projects. */
async function withStats<T extends { id: string }>(projects: T[]) {
  const ids = projects.map((p) => p.id);
  if (ids.length === 0) return projects.map((p) => ({ ...p, stats: emptyStats() }));

  const [statusGroups, assigneePairs] = await Promise.all([
    prisma.task.groupBy({
      by: ["projectId", "status"],
      where: { projectId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: { projectId: { in: ids }, assigneeId: { not: null } },
      select: { projectId: true, assigneeId: true },
      distinct: ["projectId", "assigneeId"],
    }),
  ]);

  const members = new Map<string, number>();
  for (const p of assigneePairs)
    members.set(p.projectId, (members.get(p.projectId) ?? 0) + 1);

  return projects.map((p) => {
    let total = 0,
      done = 0;
    for (const g of statusGroups) {
      if (g.projectId !== p.id) continue;
      total += g._count._all;
      if (g.status === "DONE") done += g._count._all;
    }
    return {
      ...p,
      stats: {
        totalTasks: total,
        completedTasks: done,
        activeTasks: total - done,
        members: members.get(p.id) ?? 0,
      },
    };
  });
}
function emptyStats() {
  return { totalTasks: 0, completedTasks: 0, activeTasks: 0, members: 0 };
}

export async function listProjects(req: Request, res: Response) {
  // Archived projects are hidden by default (so they drop out of task/report
  // dropdowns). The Projects page passes includeArchived=1 to see them.
  const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true";
  const where: Prisma.ProjectWhereInput = includeArchived ? {} : { isArchived: false };

  const projects = await prisma.project.findMany({
    where,
    orderBy: [{ isArchived: "asc" }, { name: "asc" }],
    include: { _count: { select: { tasks: true, reports: true } } },
  });
  res.json({ projects: await withStats(projects) });
}

export async function getProject(req: Request, res: Response) {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { tasks: true, reports: true } } },
  });
  if (!project) throw new AppError(404, "ไม่พบโปรเจกต์");
  const [withStat] = await withStats([project]);
  res.json({ project: withStat });
}

export async function createProject(req: Request, res: Response) {
  const data = req.body as CreateProjectInput;
  const project = await prisma.project.create({
    data: {
      name: data.name.trim(),
      code: data.code.trim().toUpperCase(),
      color: data.color,
      description: data.description?.trim() ?? "",
      status: data.status ?? "ACTIVE",
    },
  });
  await logActivity({
    userId: req.user!.id,
    action: "project.create",
    message: `สร้างโปรเจกต์ "${project.name}"`,
    entityType: "project",
    entityId: project.id,
  });
  res.status(201).json({ project });
}

export async function updateProject(req: Request, res: Response) {
  const data = req.body as UpdateProjectInput;
  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      name: data.name?.trim(),
      code: data.code?.trim().toUpperCase(),
      color: data.color,
      description: data.description?.trim(),
      status: data.status,
    },
  });
  await logActivity({
    userId: req.user!.id,
    action: "project.update",
    message: `แก้ไขโปรเจกต์ "${project.name}"`,
    entityType: "project",
    entityId: project.id,
  });
  res.json({ project });
}

export async function archiveProject(req: Request, res: Response) {
  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: { isArchived: true, archivedAt: new Date() },
  });
  await logActivity({
    userId: req.user!.id,
    action: "project.archive",
    message: `เก็บถาวรโปรเจกต์ "${project.name}"`,
    entityType: "project",
    entityId: project.id,
  });
  res.json({ project });
}

export async function restoreProject(req: Request, res: Response) {
  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: { isArchived: false, archivedAt: null },
  });
  await logActivity({
    userId: req.user!.id,
    action: "project.restore",
    message: `กู้คืนโปรเจกต์ "${project.name}"`,
    entityType: "project",
    entityId: project.id,
  });
  res.json({ project });
}

export async function deleteProject(req: Request, res: Response) {
  // Prefer archive; hard delete is blocked while the project still has data.
  const counts = await prisma.project.findUnique({
    where: { id: req.params.id },
    select: { name: true, _count: { select: { tasks: true, reports: true } } },
  });
  if (!counts) throw new AppError(404, "ไม่พบโปรเจกต์");
  if (counts._count.tasks > 0 || counts._count.reports > 0) {
    throw new AppError(
      409,
      "โปรเจกต์นี้ยังมีงานหรือรายงานอยู่ กรุณาเก็บถาวรแทนการลบ"
    );
  }
  await prisma.project.delete({ where: { id: req.params.id } });
  await logActivity({
    userId: req.user!.id,
    action: "project.delete",
    message: `ลบโปรเจกต์ "${counts.name}"`,
    entityType: "project",
    entityId: req.params.id,
  });
  res.status(204).send();
}
