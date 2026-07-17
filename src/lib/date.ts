/**
 * Central Asia/Bangkok date helpers.
 *
 * Bangkok is a fixed UTC+7 offset (no DST), so we can convert with a constant
 * offset rather than scattering `+ 7 * 3_600_000` math across the codebase.
 *
 * Day boundaries are the REAL Bangkok midnight expressed in UTC — i.e. a
 * Bangkok calendar day D spans [D 00:00 +07:00, D+1 00:00 +07:00), which is
 * [(D-1) 17:00Z, D 17:00Z). This correctly buckets records stored at their
 * actual instant (e.g. a report submitted at 03:00 Bangkok = 20:00Z the day
 * before still counts for the Bangkok day). Records stored date-only at 00:00Z
 * are unaffected, since 00:00Z always falls inside its own Bangkok day's range.
 */

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The instant shifted into Bangkok wall-clock, for slicing Y/M/D/H fields. */
function bangkokShifted(at: Date): Date {
  return new Date(at.getTime() + BANGKOK_OFFSET_MS);
}

/** Bangkok calendar date as `YYYY-MM-DD`. */
export function getBangkokDateString(at: Date = new Date()): string {
  return bangkokShifted(at).toISOString().slice(0, 10);
}

/** Bangkok wall-clock `HH:mm` (24h). */
export function getBangkokHM(at: Date = new Date()): string {
  return bangkokShifted(at).toISOString().slice(11, 16);
}

/** Bangkok weekday, 0=Sunday … 6=Saturday. */
export function getBangkokWeekday(at: Date = new Date()): number {
  return bangkokShifted(at).getUTCDay();
}

/** UTC instant of 00:00 Bangkok for a `YYYY-MM-DD` string. */
export function startOfBangkokDayUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000+07:00`);
}

/** UTC instant of the START of the NEXT Bangkok day (exclusive upper bound). */
export function endOfBangkokDayUtc(dateStr: string): Date {
  return new Date(startOfBangkokDayUtc(dateStr).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Half-open UTC range `[gte, lt)` covering the Bangkok calendar day `dateStr`.
 * Use directly in Prisma `where: { date: bangkokDateToUtcRange(d) }`.
 */
export function bangkokDateToUtcRange(dateStr: string): { gte: Date; lt: Date } {
  return { gte: startOfBangkokDayUtc(dateStr), lt: endOfBangkokDayUtc(dateStr) };
}

/** Whether two instants fall on the same Bangkok calendar day. */
export function isSameBangkokDay(a: Date, b: Date): boolean {
  return getBangkokDateString(a) === getBangkokDateString(b);
}
