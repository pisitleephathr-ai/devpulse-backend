import { test } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import {
  authorize,
  isAdmin,
  isManagerOrAdmin,
  isManagerRole,
} from "../src/middleware/authorize";
import { AppError } from "../src/middleware/error";

/**
 * Invoke an authorize middleware with a fake request and capture what it passes
 * to `next()`: `undefined` = allowed, an `AppError` = blocked, the "NO_CALL"
 * sentinel = next was never called.
 */
function invoke(
  mw: (req: any, res: any, next: any) => void,
  role?: string
): unknown {
  const req: any = role ? { user: { id: "u1", role } } : {};
  let passed: unknown = "NO_CALL";
  mw(req, {} as Response, (e?: unknown) => {
    passed = e;
  });
  return passed;
}

test("isAdmin allows ADMIN and blocks everyone else", () => {
  assert.equal(invoke(isAdmin, "ADMIN"), undefined);

  const blocked = invoke(isAdmin, "MANAGER");
  assert.ok(blocked instanceof AppError);
  assert.equal((blocked as AppError).statusCode, 403);

  assert.ok(invoke(isAdmin, "DEVELOPER") instanceof AppError);
});

test("isManagerOrAdmin allows MANAGER and ADMIN, blocks DEVELOPER/QA", () => {
  assert.equal(invoke(isManagerOrAdmin, "MANAGER"), undefined);
  assert.equal(invoke(isManagerOrAdmin, "ADMIN"), undefined);
  assert.ok(invoke(isManagerOrAdmin, "DEVELOPER") instanceof AppError);
  assert.ok(invoke(isManagerOrAdmin, "QA") instanceof AppError);
});

test("unauthenticated request is rejected with 401", () => {
  const err = invoke(isAdmin); // no req.user
  assert.ok(err instanceof AppError);
  assert.equal((err as AppError).statusCode, 401);
});

test("authorize() honors arbitrary role codes", () => {
  const onlyDesigner = authorize("DESIGNER");
  assert.equal(invoke(onlyDesigner, "DESIGNER"), undefined);
  assert.ok(invoke(onlyDesigner, "ADMIN") instanceof AppError);
});

test("isManagerRole is true only for MANAGER/ADMIN", () => {
  assert.equal(isManagerRole("MANAGER"), true);
  assert.equal(isManagerRole("ADMIN"), true);
  assert.equal(isManagerRole("DEVELOPER"), false);
  assert.equal(isManagerRole("QA"), false);
});
