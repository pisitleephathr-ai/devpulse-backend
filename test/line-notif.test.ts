import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roleAllowsNotif,
  allowedNotifKeys,
  notifColumn,
  LINE_NOTIF_KEYS,
} from "../src/lib/line-notif";

test("roleAllowsNotif: empty/undefined list allows everything (default)", () => {
  assert.equal(roleAllowsNotif(undefined, "taskAssigned"), true);
  assert.equal(roleAllowsNotif(null, "leaveDecision"), true);
  assert.equal(roleAllowsNotif([], "reportReminder"), true);
});

test("roleAllowsNotif: non-empty list allows only listed keys", () => {
  const allowed = ["taskAssigned"];
  assert.equal(roleAllowsNotif(allowed, "taskAssigned"), true);
  assert.equal(roleAllowsNotif(allowed, "leaveDecision"), false);
  assert.equal(roleAllowsNotif(allowed, "reportReminder"), false);
});

test("allowedNotifKeys: default (empty) returns all keys", () => {
  assert.deepEqual(allowedNotifKeys([]), LINE_NOTIF_KEYS);
  assert.deepEqual(allowedNotifKeys(undefined), LINE_NOTIF_KEYS);
});

test("allowedNotifKeys: filters to the allowed subset, preserving order", () => {
  assert.deepEqual(allowedNotifKeys(["reportReminder", "taskAssigned"]), [
    "taskAssigned",
    "reportReminder",
  ]);
});

test("notifColumn: maps each key to its User boolean column", () => {
  assert.equal(notifColumn("taskAssigned"), "lineNotifyTaskAssigned");
  assert.equal(notifColumn("leaveDecision"), "lineNotifyLeaveDecision");
  assert.equal(notifColumn("reportReminder"), "lineNotifyReportReminder");
});
