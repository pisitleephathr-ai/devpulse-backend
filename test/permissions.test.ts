import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { expandPermissions, roleIsAdmin, PERMISSIONS } from "../src/lib/roles";
import { hasPermission, isFullAdmin, isTeamManager } from "../src/lib/authz";

const asReq = (role: string | null, permissions: string[] = []): Request =>
  ({ user: { id: "u1", role, permissions } }) as unknown as Request;

test("legacy ADMIN code expands to every capability", () => {
  const set = expandPermissions([], "ADMIN");
  assert.ok(set.has(PERMISSIONS.ADMIN_FULL));
  assert.ok(set.has(PERMISSIONS.TEAM_MANAGE));
  assert.ok(set.has(PERMISSIONS.USER_MANAGE));
  assert.ok(set.has(PERMISSIONS.ROLE_MANAGE));
  assert.ok(set.has(PERMISSIONS.TASK_EDIT_ANY));
});

test("legacy MANAGER code expands to the manager set but NOT admin-only caps", () => {
  const set = expandPermissions([], "MANAGER");
  assert.ok(set.has(PERMISSIONS.TEAM_MANAGE));
  assert.ok(set.has(PERMISSIONS.LEAVE_APPROVE));
  assert.ok(set.has(PERMISSIONS.TASK_EDIT_ANY));
  assert.ok(set.has(PERMISSIONS.PROJECT_MANAGE));
  assert.ok(!set.has(PERMISSIONS.USER_MANAGE));
  assert.ok(!set.has(PERMISSIONS.ROLE_MANAGE));
  assert.ok(!set.has(PERMISSIONS.ADMIN_FULL));
});

test("ADMIN_FULL grant (any code) implies all", () => {
  const set = expandPermissions(["ADMIN_FULL"], "DEVELOPER");
  for (const p of Object.values(PERMISSIONS)) assert.ok(set.has(p));
});

test("TEAM_MANAGE grant implies the manager set, not admin-only", () => {
  const set = expandPermissions(["TEAM_MANAGE"], null);
  assert.ok(set.has(PERMISSIONS.TASK_DELETE));
  assert.ok(!set.has(PERMISSIONS.USER_MANAGE));
});

test("a narrow fine-grained grant does not leak into other capabilities", () => {
  const set = expandPermissions(["TASK_EDIT_ANY"], "DEVELOPER");
  assert.ok(set.has(PERMISSIONS.TASK_EDIT_ANY));
  assert.ok(!set.has(PERMISSIONS.TEAM_MANAGE));
  assert.ok(!set.has(PERMISSIONS.LEAVE_APPROVE));
});

test("a role with no grants has nothing", () => {
  const set = expandPermissions([], "DEVELOPER");
  assert.equal(set.size, 0);
});

test("hasPermission reflects the expanded set", () => {
  assert.ok(hasPermission(asReq("DEVELOPER", ["TASK_EDIT_ANY"]), PERMISSIONS.TASK_EDIT_ANY));
  assert.ok(!hasPermission(asReq("DEVELOPER", ["TASK_EDIT_ANY"]), PERMISSIONS.LEAVE_APPROVE));
  assert.ok(hasPermission(asReq("MANAGER"), PERMISSIONS.LEAVE_APPROVE));
  assert.ok(hasPermission(asReq(null, ["ADMIN_FULL"]), PERMISSIONS.USER_MANAGE));
});

test("isFullAdmin / isTeamManager stay backward-compatible", () => {
  assert.ok(isFullAdmin(asReq("ADMIN")));
  assert.ok(isFullAdmin(asReq(null, ["ADMIN_FULL"])));
  assert.ok(!isFullAdmin(asReq("MANAGER")));
  assert.ok(isTeamManager(asReq("MANAGER")));
  assert.ok(isTeamManager(asReq("ADMIN")));
  assert.ok(isTeamManager(asReq(null, ["TEAM_MANAGE"])));
  assert.ok(!isTeamManager(asReq("DEVELOPER")));
});

test("roleIsAdmin helper", () => {
  assert.ok(roleIsAdmin([], "ADMIN"));
  assert.ok(roleIsAdmin(["ADMIN_FULL"], "DEVELOPER"));
  assert.ok(!roleIsAdmin(["TEAM_MANAGE"], "MANAGER"));
  assert.ok(!roleIsAdmin(null, "DEVELOPER"));
});
