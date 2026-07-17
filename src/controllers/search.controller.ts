import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { userMiniSelect } from "../lib/selects";
import { isTeamManager } from "../lib/authz";
import { getBangkokDateString } from "../lib/date";

type SearchResult = {
  id: string;
  type: "TASK" | "REPORT" | "USER" | "PROJECT" | "LEAVE" | "CALENDAR";
  title: string;
  subtitle: string;
  url: string;
  metadata?: Record<string, unknown>;
};

const PER_TYPE = 6;
const insensitive = "insensitive" as const;

const LEAVE_TYPE_LABEL: Record<string, string> = {
  VACATION: "ลาพักร้อน",
  SICK: "ลาป่วย",
  PERSONAL: "ลากิจ",
  PARENTAL: "ลาเลี้ยงดูบุตร",
};

/**
 * Global search across tasks, reports, users, projects, leaves and calendar
 * events. Case-insensitive, Thai+English. RBAC is preserved: leaves are scoped
 * to the requester unless they are a manager/admin (mirrors the leaves list);
 * everything else follows the app's existing team-wide read visibility.
 */
export async function search(req: Request, res: Response) {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 1) return res.json({ results: [] });

  const isManager = isTeamManager(req);
  const contains = { contains: q, mode: insensitive };

  const leaveWhere: Prisma.LeaveRequestWhereInput = {
    reason: contains,
    // Non-managers only search within their own leave requests.
    ...(isManager ? {} : { userId: req.user!.id }),
  };

  const [tasks, reports, users, projects, leaves, events] = await Promise.all([
    prisma.task.findMany({
      where: { OR: [{ title: contains }, { description: contains }] },
      include: {
        project: { select: { name: true } },
        assignee: { select: { name: true } },
      },
      take: PER_TYPE,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.dailyReport.findMany({
      where: {
        OR: [
          { did: contains },
          { plan: contains },
          { blockers: contains },
          { summary: contains },
        ],
      },
      include: {
        author: { select: { name: true } },
        project: { select: { name: true } },
      },
      take: PER_TYPE,
      orderBy: { date: "desc" },
    }),
    prisma.user.findMany({
      where: { OR: [{ name: contains }, { email: contains }] },
      select: { ...userMiniSelect, email: true },
      take: PER_TYPE,
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: {
        isArchived: false,
        OR: [{ name: contains }, { code: contains }],
      },
      take: PER_TYPE,
      orderBy: { name: "asc" },
    }),
    prisma.leaveRequest.findMany({
      where: leaveWhere,
      include: { user: { select: { name: true } } },
      take: PER_TYPE,
      orderBy: { createdAt: "desc" },
    }),
    prisma.calendarEvent.findMany({
      where: { title: contains },
      take: PER_TYPE,
      orderBy: { startDate: "desc" },
    }),
  ]);

  const results: SearchResult[] = [
    ...tasks.map((t) => ({
      id: t.id,
      type: "TASK" as const,
      title: t.title,
      subtitle: [t.project?.name, t.assignee?.name].filter(Boolean).join(" · "),
      // Deep-link straight to the task's card on the board.
      url: `/tasks?task=${t.id}`,
      metadata: { status: t.status, priority: t.priority },
    })),
    ...reports.map((r) => ({
      id: r.id,
      type: "REPORT" as const,
      title: `รายงาน: ${r.author.name}`,
      subtitle: [r.project?.name, getBangkokDateString(new Date(r.date))]
        .filter(Boolean)
        .join(" · "),
      url: "/reports",
    })),
    ...users.map((u) => ({
      id: u.id,
      type: "USER" as const,
      title: u.name,
      subtitle: u.email,
      url: "/users",
      metadata: { avatarKey: u.avatarKey },
    })),
    ...projects.map((p) => ({
      id: p.id,
      type: "PROJECT" as const,
      title: p.name,
      subtitle: p.code,
      url: "/projects",
      metadata: { color: p.color },
    })),
    ...leaves.map((l) => ({
      id: l.id,
      type: "LEAVE" as const,
      title: `${l.user.name} · ${LEAVE_TYPE_LABEL[l.type] ?? l.type}`,
      subtitle: l.reason,
      url: "/leaves",
      metadata: { status: l.status },
    })),
    ...events.map((e) => ({
      id: e.id,
      type: "CALENDAR" as const,
      title: e.title,
      subtitle: getBangkokDateString(new Date(e.startDate)),
      url: "/calendar",
    })),
  ];

  res.json({ results });
}
