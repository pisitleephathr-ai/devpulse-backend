import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedTransition,
  isDeliveryTarget,
  ALLOWED_TRANSITIONS,
  CLOSED_STATUSES,
} from "../src/lib/task-workflow";

test("forward pipeline steps are allowed, one at a time", () => {
  assert.ok(isAllowedTransition("TODO", "IN_PROGRESS"));
  assert.ok(isAllowedTransition("IN_PROGRESS", "DEV_REVIEW"));
  assert.ok(isAllowedTransition("DEV_REVIEW", "DEV_DONE"));
  assert.ok(isAllowedTransition("DEV_DONE", "DELIVERY_DONE"));
  assert.ok(isAllowedTransition("DEV_DONE", "DELIVERY_FAIL"));
});

test("skipping a step is not allowed", () => {
  assert.equal(isAllowedTransition("TODO", "DEV_REVIEW"), false);
  assert.equal(isAllowedTransition("TODO", "DELIVERY_DONE"), false);
  assert.equal(isAllowedTransition("IN_PROGRESS", "DEV_DONE"), false);
  assert.equal(isAllowedTransition("DEV_REVIEW", "DELIVERY_DONE"), false);
});

test("moving backward is not allowed", () => {
  assert.equal(isAllowedTransition("IN_PROGRESS", "TODO"), false);
  assert.equal(isAllowedTransition("DEV_DONE", "DEV_REVIEW"), false);
  assert.equal(isAllowedTransition("DELIVERY_DONE", "DEV_DONE"), false);
  assert.equal(isAllowedTransition("DELIVERY_FAIL", "TODO"), false);
});

test("terminal statuses have no outgoing transitions", () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.DELIVERY_DONE, []);
  assert.deepEqual(ALLOWED_TRANSITIONS.DELIVERY_FAIL, []);
});

test("delivery targets are the tester-only moves", () => {
  assert.ok(isDeliveryTarget("DELIVERY_DONE"));
  assert.ok(isDeliveryTarget("DELIVERY_FAIL"));
  assert.equal(isDeliveryTarget("DEV_DONE"), false);
  assert.equal(isDeliveryTarget("IN_PROGRESS"), false);
});

test("closed statuses are the two delivery terminals", () => {
  assert.deepEqual([...CLOSED_STATUSES].sort(), ["DELIVERY_DONE", "DELIVERY_FAIL"]);
});
