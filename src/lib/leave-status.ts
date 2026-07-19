import { prisma } from "./prisma";
import { bangkokDateToUtcRange } from "./date";

/**
 * User ids with an APPROVED, FULL-day leave covering the given Bangkok day
 * (YYYY-MM-DD). A leave covers the day when it starts on/before and ends on/after
 * it. Half-day leaves (halfDayPeriod set) are excluded — those people are still
 * expected to submit a daily report. Used so full-day leave takers aren't counted
 * as "missing a report" and are shown as "on leave" on the dashboard + standup.
 */
export async function onLeaveUserIds(dateStr: string): Promise<Set<string>> {
  const { gte, lt } = bangkokDateToUtcRange(dateStr);
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      startDate: { lt },
      endDate: { gte },
      halfDayPeriod: null, // full-day only; half-day leavers still report
    },
    select: { userId: true },
  });
  return new Set(leaves.map((l) => l.userId));
}
