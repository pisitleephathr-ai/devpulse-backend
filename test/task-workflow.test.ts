import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedTransition,
  isTesterTarget,
  isTesterOwned,
  ALLOWED_TRANSITIONS,
  CLOSED_STATUSES,
} from "../src/lib/task-workflow";

test("forward pipeline steps are allowed, one at a time", () => {
  assert.ok(isAllowedTransition("TODO", "IN_PROGRESS"));
  assert.ok(isAllowedTransition("IN_PROGRESS", "DEV_REVIEW"));
  assert.ok(isAllowedTransition("DEV_REVIEW", "DEV_DONE"));
  // Handoff to the tester: dev done → actively testing → final verdict.
  assert.ok(isAllowedTransition("DEV_DONE", "TESTING"));
  assert.ok(isAllowedTransition("TESTING", "DELIVERY_DONE"));
  assert.ok(isAllowedTransition("TESTING", "DELIVERY_FAIL"));
});

test("skipping a step is not allowed", () => {
  assert.equal(isAllowedTransition("TODO", "DEV_REVIEW"), false);
  assert.equal(isAllowedTransition("TODO", "DELIVERY_DONE"), false);
  assert.equal(isAllowedTransition("IN_PROGRESS", "DEV_DONE"), false);
  assert.equal(isAllowedTransition("DEV_REVIEW", "DELIVERY_DONE"), false);
  // Dev can no longer jump straight to a delivery verdict — testing sits between.
  assert.equal(isAllowedTransition("DEV_DONE", "DELIVERY_DONE"), false);
  assert.equal(isAllowedTransition("DEV_DONE", "DELIVERY_FAIL"), false);
});

test("moving backward is not allowed", () => {
  assert.equal(isAllowedTransition("IN_PROGRESS", "TODO"), false);
  assert.equal(isAllowedTransition("DEV_DONE", "DEV_REVIEW"), false);
  assert.equal(isAllowedTransition("TESTING", "DEV_DONE"), false);
  assert.equal(isAllowedTransition("DELIVERY_DONE", "TESTING"), false);
  assert.equal(isAllowedTransition("DELIVERY_FAIL", "TODO"), false);
});

test("terminal statuses have no outgoing transitions", () => {
  assert.deepEqual(ALLOWED_TRANSITIONS.DELIVERY_DONE, []);
  assert.deepEqual(ALLOWED_TRANSITIONS.DELIVERY_FAIL, []);
});

test("tester-owned moves are start-test and the delivery verdicts", () => {
  assert.ok(isTesterTarget("TESTING"));
  assert.ok(isTesterTarget("DELIVERY_DONE"));
  assert.ok(isTesterTarget("DELIVERY_FAIL"));
  assert.equal(isTesterTarget("DEV_DONE"), false);
  assert.equal(isTesterTarget("IN_PROGRESS"), false);
});

test("open cards in the tester's hands are dev-done and testing", () => {
  assert.ok(isTesterOwned("DEV_DONE"));
  assert.ok(isTesterOwned("TESTING"));
  assert.equal(isTesterOwned("DEV_REVIEW"), false);
  assert.equal(isTesterOwned("DELIVERY_DONE"), false);
});

test("closed statuses are the two delivery terminals", () => {
  assert.deepEqual([...CLOSED_STATUSES].sort(), ["DELIVERY_DONE", "DELIVERY_FAIL"]);
});
