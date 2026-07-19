import { prisma } from "./prisma";
import { getBangkokWeekday, bangkokDateToUtcRange } from "./date";

/**
 * Whether a Bangkok calendar day (YYYY-MM-DD) is a working day, plus the company
 * holiday on it (if any). A day is non-working when its weekday is not in
 * TeamSetting.workingDays OR it is an active CompanyHoliday. Used so daily-report
 * expectations (dashboard "missing" counts, standup queue, reminders) skip
 * weekends/holidays uniformly — mirroring the scheduler's own logic.
 */
export async function workdayInfo(dateStr: string): Promise<{
  isWorkingDay: boolean;
  holiday: { name: string; type: string } | null;
}> {
  const { gte, lt } = bangkokDateToUtcRange(dateStr);
  const [setting, holiday] = await Promise.all([
    prisma.teamSetting.findFirst({ select: { workingDays: true } }),
    prisma.companyHoliday.findFirst({
      where: { isActive: true, date: { gte, lt } },
      select: { name: true, type: true },
    }),
  ]);
  const workingDays = new Set(
    (setting?.workingDays ?? "1,2,3,4,5").split(",").filter(Boolean).map(Number)
  );
  const weekday = getBangkokWeekday(gte); // 0=Sun … 6=Sat
  return { isWorkingDay: workingDays.has(weekday) && !holiday, holiday };
}
