import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getBangkokDateString,
  getBangkokHM,
  getBangkokWeekday,
  startOfBangkokDayUtc,
  endOfBangkokDayUtc,
  bangkokDateToUtcRange,
  isSameBangkokDay,
} from "../src/lib/date";

test("00:00 Bangkok maps to the previous day's 17:00Z", () => {
  assert.equal(
    startOfBangkokDayUtc("2026-07-18").toISOString(),
    "2026-07-17T17:00:00.000Z"
  );
  assert.equal(
    endOfBangkokDayUtc("2026-07-18").toISOString(),
    "2026-07-18T17:00:00.000Z"
  );
});

test("getBangkokDateString flips exactly at 17:00Z", () => {
  // 23:59 Bangkok
  assert.equal(getBangkokDateString(new Date("2026-07-17T16:59:59Z")), "2026-07-17");
  // 00:00 Bangkok of the next day
  assert.equal(getBangkokDateString(new Date("2026-07-17T17:00:00Z")), "2026-07-18");
});

test("06:59 and 07:00 Bangkok are the same Bangkok day across 00:00Z", () => {
  const a = new Date("2026-07-17T23:59:00Z"); // 06:59 Bangkok (18th)
  const b = new Date("2026-07-18T00:00:00Z"); // 07:00 Bangkok (18th)
  assert.equal(getBangkokDateString(a), "2026-07-18");
  assert.equal(getBangkokDateString(b), "2026-07-18");
  // UTC calendar dates differ, Bangkok day does not.
  assert.notEqual(a.toISOString().slice(0, 10), b.toISOString().slice(0, 10));
  assert.ok(isSameBangkokDay(a, b));
});

test("range is half-open and exactly 24h", () => {
  const { gte, lt } = bangkokDateToUtcRange("2026-07-18");
  assert.equal(gte.toISOString(), "2026-07-17T17:00:00.000Z");
  assert.equal(lt.toISOString(), "2026-07-18T17:00:00.000Z");
  assert.equal(lt.getTime() - gte.getTime(), 24 * 60 * 60 * 1000);
});

test("a record at 03:00 Bangkok counts for that Bangkok day (instant-stored)", () => {
  const submittedAt = new Date("2026-07-17T20:00:00Z"); // 03:00 Bangkok, 18th
  const { gte, lt } = bangkokDateToUtcRange("2026-07-18");
  assert.ok(submittedAt >= gte && submittedAt < lt);
  // And it is NOT in the previous Bangkok day's range.
  const prev = bangkokDateToUtcRange("2026-07-17");
  assert.ok(!(submittedAt >= prev.gte && submittedAt < prev.lt));
});

test("a date-only 00:00Z record buckets into its own Bangkok day", () => {
  const stored = new Date("2026-07-18T00:00:00Z"); // date-only convention
  const { gte, lt } = bangkokDateToUtcRange("2026-07-18");
  assert.ok(stored >= gte && stored < lt);
});

test("getBangkokHM slices the Bangkok wall-clock", () => {
  assert.equal(getBangkokHM(new Date("2026-07-17T17:00:00Z")), "00:00");
  assert.equal(getBangkokHM(new Date("2026-07-18T02:30:00Z")), "09:30");
});

test("weekday advances by one across a Bangkok day", () => {
  const d1 = getBangkokWeekday(new Date("2026-07-18T05:00:00Z"));
  const d2 = getBangkokWeekday(new Date("2026-07-19T05:00:00Z"));
  assert.equal(d2, (d1 + 1) % 7);
});
