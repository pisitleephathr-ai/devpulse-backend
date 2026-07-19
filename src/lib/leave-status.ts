import { prisma } from "./prisma";
import { bangkokDateToUtcRange } from "./date";

/**
 * User ids with an APPROVED leave covering the given Bangkok day (YYYY-MM-DD).
 * A leave covers the day when it starts on/before the day and ends on/after it.
 * Used so people on approved leave aren't counted as "missing a daily report"
 * and are shown as "on leave" on the dashboard + standup instead.
 */
export async function onLeaveUserIds(dateStr: string): Promise<Set<string>> {
  const { gte, lt } = bangkokDateToUtcRange(dateStr);
  const leaves = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", startDate: { lt }, endDate: { gte } },
    select: { userId: true },
  });
  return new Set(leaves.map((l) => l.userId));
}
