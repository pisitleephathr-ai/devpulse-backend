import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import type {
  CalendarQuery,
  CreateEventInput,
} from "../schemas/calendar.schema";

const projectSelect = { id: true, name: true, code: true, color: true };

/**
 * Aggregate calendar items for a month from real data: manual events, task
 * due dates, daily-report dates, and approved leave requests. Returns a
 * normalized `items` array (plus `events` for backward compatibility).
 * Month bounds use UTC (imported dates are stored at UTC midnight, so the UTC
 * day equals the Bangkok day — no off-by-one shift).
 */
export async function listEvents(req: Request, res: Response) {
  const { year, month } = req.query as unknown as CalendarQuery;

  // Default to the current month if not supplied.
  const now = new Date();
  const y = year ?? now.getUTCFullYear();
  const m = month ?? now.getUTCMonth() + 1;

  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const endExclusive = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  const endInclusive = new Date(endExclusive.getTime() - 1);

  const isManager = req.user!.role === "MANAGER" || req.user!.role === "ADMIN";

  const [events, tasks, reports, leaves] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { startDate: { lte: endInclusive }, endDate: { gte: start } },
      orderBy: { startDate: "asc" },
    }),
    prisma.task.findMany({
      where: { dueDate: { gte: start, lt: endExclusive } },
      include: { project: { select: projectSelect }, assignee: { select: userMiniSelect } },
    }),
    prisma.dailyReport.findMany({
      where: { date: { gte: start, lt: endExclusive } },
      include: { project: { select: projectSelect }, author: { select: userMiniSelect } },
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: endInclusive },
        endDate: { gte: start },
        // Non-managers only see their own leaves on the calendar.
        ...(isManager ? {} : { userId: req.user!.id }),
      },
      include: { user: { select: userMiniSelect } },
    }),
  ]);

  const items = [
    ...events.map((e) => ({
      id: `event_${e.id}`,
      type: "EVENT" as const,
      title: e.title,
      date: e.startDate,
      endDate: e.endDate,
      entityId: e.id,
    })),
    ...tasks.map((t) => ({
      id: `task_${t.id}`,
      type: "TASK" as const,
      title: t.title,
      date: t.dueDate,
      project: t.project,
      user: t.assignee,
      status: t.status,
      priority: t.priority,
      entityId: t.id,
    })),
    ...reports.map((r) => ({
      id: `report_${r.id}`,
      type: "REPORT" as const,
      title: r.author.name,
      date: r.date,
      project: r.project,
      user: r.author,
      status: r.status,
      entityId: r.id,
    })),
    ...leaves.map((l) => ({
      id: `leave_${l.id}`,
      type: "LEAVE" as const,
      title: l.user.name,
      date: l.startDate,
      endDate: l.endDate,
      user: l.user,
      status: l.status,
      entityId: l.id,
    })),
  ];

  res.json({ items, events });
}

export async function createEvent(req: Request, res: Response) {
  const data = req.body as CreateEventInput;
  const event = await prisma.calendarEvent.create({
    data: {
      title: data.title.trim(),
      startDate: data.startDate,
      endDate: data.endDate ?? data.startDate,
      type: data.type,
    },
  });
  res.status(201).json({ event });
}

export async function deleteEvent(req: Request, res: Response) {
  await prisma.calendarEvent.delete({ where: { id: req.params.id } });
  res.status(204).send();
}
