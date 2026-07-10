import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type {
  CalendarQuery,
  CreateEventInput,
} from "../schemas/calendar.schema";

export async function listEvents(req: Request, res: Response) {
  const { year, month } = req.query as unknown as CalendarQuery;

  let where: Prisma.CalendarEventWhereInput = {};
  if (year && month) {
    // Events overlapping the requested month.
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    where = { startDate: { lte: end }, endDate: { gte: start } };
  }

  const events = await prisma.calendarEvent.findMany({
    where,
    orderBy: { startDate: "asc" },
  });
  res.json({ events });
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
