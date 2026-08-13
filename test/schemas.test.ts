import { test } from "node:test";
import assert from "node:assert/strict";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from "../src/schemas/auth.schema";
import {
  createReportSchema,
  updateReportSchema,
  reportQuerySchema,
} from "../src/schemas/report.schema";
import { createTaskSchema, linkSchema } from "../src/schemas/task.schema";
import { createLeaveSchema } from "../src/schemas/leave.schema";
import { createUserSchema } from "../src/schemas/user.schema";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

test("loginSchema requires a valid email and a password", () => {
  assert.equal(ok(loginSchema, { email: "a@b.co", password: "x" }), true);
  assert.equal(ok(loginSchema, { email: "not-an-email", password: "x" }), false);
  assert.equal(ok(loginSchema, { email: "a@b.co" }), false);
});

test("forgotPasswordSchema requires a valid email and normalizes it", () => {
  assert.equal(ok(forgotPasswordSchema, { email: "a@b.co" }), true);
  assert.equal(ok(forgotPasswordSchema, { email: "not-an-email" }), false);
  assert.equal(ok(forgotPasswordSchema, {}), false);
  const r = forgotPasswordSchema.safeParse({ email: "  Boss@DevPulse.IO " });
  assert.equal(r.success && r.data.email, "boss@devpulse.io");
});

test("resetPasswordSchema needs token, 8+ char password, matching confirm", () => {
  const base = { token: "t", newPassword: "abcd1234", confirmPassword: "abcd1234" };
  assert.equal(ok(resetPasswordSchema, base), true);
  assert.equal(ok(resetPasswordSchema, { ...base, token: "" }), false);
  assert.equal(ok(resetPasswordSchema, { ...base, newPassword: "short", confirmPassword: "short" }), false);
  assert.equal(ok(resetPasswordSchema, { ...base, confirmPassword: "different" }), false);
});

test("createReportSchema requires projectId + did; relatedTaskIds is optional", () => {
  assert.equal(ok(createReportSchema, { projectId: "p1", did: "did work" }), true);
  assert.equal(
    ok(createReportSchema, { projectId: "p1", did: "did work", relatedTaskIds: ["t1", "t2"] }),
    true
  );
  assert.equal(ok(createReportSchema, { projectId: "p1", did: "" }), false);
  assert.equal(ok(createReportSchema, { did: "did work" }), false);
});

test("updateReportSchema is fully partial and validates enums", () => {
  assert.equal(ok(updateReportSchema, {}), true);
  assert.equal(ok(updateReportSchema, { status: "SUBMITTED" }), true);
  assert.equal(ok(updateReportSchema, { status: "NOT_A_STATUS" }), false);
});

test("reportQuerySchema coerces pagination params and caps limit", () => {
  const r = reportQuerySchema.safeParse({ limit: "20", page: "2" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.limit, 20);
    assert.equal(r.data.page, 2);
  }
  assert.equal(ok(reportQuerySchema, {}), true); // both optional (unpaginated)
  assert.equal(ok(reportQuerySchema, { limit: "0" }), false); // must be positive
  assert.equal(ok(reportQuerySchema, { limit: "500" }), false); // capped at 100
});

test("createTaskSchema requires a title + projectId; link URLs are validated", () => {
  assert.equal(ok(createTaskSchema, { title: "Task", projectId: "p1" }), true);
  assert.equal(ok(createTaskSchema, { title: "", projectId: "p1" }), false);
  assert.equal(ok(linkSchema, { title: "L", url: "https://example.com" }), true);
  assert.equal(ok(linkSchema, { title: "L", url: "not-a-url" }), false);
});

test("createLeaveSchema enforces date ordering and half-day-same-day rules", () => {
  const base = { type: "VACATION", reason: "trip" };
  // endDate before startDate
  assert.equal(
    ok(createLeaveSchema, { ...base, startDate: "2026-07-10", endDate: "2026-07-09" }),
    false
  );
  // valid multi-day range
  assert.equal(
    ok(createLeaveSchema, { ...base, startDate: "2026-07-10", endDate: "2026-07-12" }),
    true
  );
  // half-day must be a single day
  assert.equal(
    ok(createLeaveSchema, {
      ...base,
      startDate: "2026-07-10",
      endDate: "2026-07-11",
      halfDayPeriod: "MORNING",
    }),
    false
  );
  assert.equal(
    ok(createLeaveSchema, {
      ...base,
      startDate: "2026-07-10",
      endDate: "2026-07-10",
      halfDayPeriod: "AFTERNOON",
    }),
    true
  );
});

test("createUserSchema requires roleId or roleCode", () => {
  assert.equal(
    ok(createUserSchema, { name: "N", email: "a@b.co", password: "secret" }),
    false
  );
  assert.equal(
    ok(createUserSchema, { name: "N", email: "a@b.co", password: "secret", roleCode: "DEVELOPER" }),
    true
  );
  assert.equal(
    ok(createUserSchema, { name: "N", email: "bad", password: "secret", roleCode: "DEVELOPER" }),
    false
  );
});
