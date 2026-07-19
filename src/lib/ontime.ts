import { prisma } from "./prisma";
import { getBangkokDateString } from "./date";

export type OnTimeStat = {
  userId: string;
  closed: number;
  onTime: number;
  late: number;
  /** onTime / closed as a 0–100 percentage */
  rate: number;
};

/**
 * Per-user on-time completion stats over DONE tasks that have BOTH a completedAt
 * and a dueDate. A task counts as on-time when it was completed on or before its
 * due date's Bangkok day (whole-day granularity — comparing YYYY-MM-DD strings).
 * Multi-assignee aware (each assignee is credited). Pass `since` to limit to
 * tasks completed on/after a date (e.g. the last 7 days for a weekly summary).
 */
export async function onTimeStatsByUser(
  since?: Date
): Promise<Map<string, OnTimeStat>> {
  const rows = await prisma.taskAssignee.findMany({
    where: {
      task: {
        status: "DONE",
        completedAt: since ? { not: null, gte: since } : { not: null },
        dueDate: { not: null },
      },
    },
    select: {
      userId: true,
      task: { select: { completedAt: true, dueDate: true } },
    },
  });

  const stats = new Map<string, OnTimeStat>();
  for (const r of rows) {
    const { completedAt, dueDate } = r.task;
    if (!completedAt || !dueDate) continue;
    const onTime =
      getBangkokDateString(completedAt) <= getBangkokDateString(dueDate);
    const s =
      stats.get(r.userId) ??
      { userId: r.userId, closed: 0, onTime: 0, late: 0, rate: 0 };
    s.closed += 1;
    if (onTime) s.onTime += 1;
    else s.late += 1;
    stats.set(r.userId, s);
  }
  for (const s of stats.values()) {
    s.rate = s.closed ? Math.round((s.onTime / s.closed) * 100) : 0;
  }
  return stats;
}
