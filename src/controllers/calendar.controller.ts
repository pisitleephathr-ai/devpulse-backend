import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { isTeamManager } from "../lib/authz";
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

  const isManager = isTeamManager(req);

  const [events, tasks, leaves, holidays, setting] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { startDate: { lte: endInclusive }, endDate: { gte: start } },
      orderBy: { startDate: "asc" },
    }),
    // Tasks span createdAt → dueDate (a work window), so include any task whose
    // span overlaps the month. Tasks without a due date are omitted, and TODO
    // tasks (created but not started) are hidden from the calendar.
    prisma.task.findMany({
      where: {
        dueDate: { not: null, gte: start },
        createdAt: { lt: endExclusive },
        status: { not: "TODO" },
      },
      include: { project: { select: projectSelect }, assignee: { select: userMiniSelect } },
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
    prisma.companyHoliday.findMany({
      where: { isActive: true, date: { gte: start, lt: endExclusive } },
      orderBy: { date: "asc" },
    }),
    prisma.teamSetting.findFirst({ select: { workingDays: true } }),
  ]);
  const workingDays = setting?.workingDays ?? "1,2,3,4,5";

  const items = [
    ...events.map((e) => ({
      id: `event_${e.id}`,
      type: "EVENT" as const,
      title: e.title,
      date: e.startDate,
      endDate: e.endDate,
      entityId: e.id,
    })),
    ...tasks.map((t) => {
      // Bar from creation to due date (guard against a due date before creation).
      const dstart = t.createdAt <= t.dueDate! ? t.createdAt : t.dueDate!;
      const dend = t.createdAt <= t.dueDate! ? t.dueDate! : t.createdAt;
      return {
        id: `task_${t.id}`,
        type: "TASK" as const,
        title: t.title,
        date: dstart,
        endDate: dend,
        project: t.project,
        user: t.assignee,
        status: t.status,
        priority: t.priority,
        entityId: t.id,
      };
    }),
    ...leaves.map((l) => ({
      id: `leave_${l.id}`,
      type: "LEAVE" as const,
      title: l.user.name,
      date: l.startDate,
      endDate: l.endDate,
      user: l.user,
      status: l.status,
      halfDayPeriod: l.halfDayPeriod,
      entityId: l.id,
    })),
    ...holidays.map((h) => ({
      id: `holiday_${h.id}`,
      type: "HOLIDAY" as const,
      title: h.name,
      date: h.date,
      description: h.description,
      holidayType: h.type,
      entityId: h.id,
    })),
  ];

  res.json({ items, events, workingDays });
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
