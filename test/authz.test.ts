import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { isFullAdmin, isTeamManager } from "../src/lib/authz";

const req = (role: string, permissions: string[] = []) =>
  ({ user: { id: "u", role, permissions } }) as unknown as Request;

test("legacy ADMIN/MANAGER codes still grant access (no permissions needed)", () => {
  assert.equal(isFullAdmin(req("ADMIN")), true);
  assert.equal(isTeamManager(req("ADMIN")), true);
  assert.equal(isTeamManager(req("MANAGER")), true);
  assert.equal(isFullAdmin(req("MANAGER")), false);
  assert.equal(isTeamManager(req("DEVELOPER")), false);
  assert.equal(isFullAdmin(req("DEVELOPER")), false);
});

test("custom roles gain access via permissions", () => {
  assert.equal(isTeamManager(req("TEAMLEAD", ["TEAM_MANAGE"])), true);
  assert.equal(isFullAdmin(req("TEAMLEAD", ["TEAM_MANAGE"])), false);
  assert.equal(isFullAdmin(req("SUPERUSER", ["ADMIN_FULL"])), true);
  // ADMIN_FULL implies team-management.
  assert.equal(isTeamManager(req("SUPERUSER", ["ADMIN_FULL"])), true);
});

test("missing user or empty permissions is denied", () => {
  assert.equal(isTeamManager({} as Request), false);
  assert.equal(isFullAdmin({} as Request), false);
  assert.equal(isTeamManager(req("DEVELOPER", [])), false);
});
