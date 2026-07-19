import { test, before } from "node:test";
import assert from "node:assert/strict";

// cloudinary.ts imports env.ts, which validates process.env at load and exits on
// misconfig. Provide safe defaults BEFORE the module loads (matching the
// jwt.test.ts pattern). CLOUDINARY_* is intentionally left unset so
// isConfigured() is false. Import happens in a `before` hook, not top-level.
process.env.DATABASE_URL ??=
  "postgresql://user:pass@localhost:5432/devpulse_test?schema=public";
process.env.JWT_SECRET ??= "test-secret-that-is-at-least-16-characters";
process.env.NODE_ENV ??= "test";

// ROOT_FOLDER defaults to "devpulse" (CLOUDINARY_UPLOAD_FOLDER unset).
const TASK = "task-123";
const FOLDER = "devpulse/tasks/task-123";

let cld: typeof import("../src/lib/cloudinary");

before(async () => {
  cld = await import("../src/lib/cloudinary");
});

test("taskFolder builds the per-task folder path", () => {
  assert.equal(cld.taskFolder(TASK), FOLDER);
});

test("validateCloudinaryFolder accepts only the exact task folder", () => {
  assert.ok(cld.validateCloudinaryFolder(FOLDER, TASK));
  assert.ok(!cld.validateCloudinaryFolder("devpulse/tasks/other", TASK));
  assert.ok(!cld.validateCloudinaryFolder("devpulse/tasks/task-123/sub", TASK));
});

test("validatePublicId accepts a folder-prefixed id for the task", () => {
  assert.ok(cld.validatePublicId(`${FOLDER}/abc-uuid`, TASK));
});

test("validatePublicId accepts a bare id (no slashes)", () => {
  assert.ok(cld.validatePublicId("abc-uuid", TASK));
});

test("validatePublicId rejects another task's folder (IDOR)", () => {
  assert.ok(!cld.validatePublicId("devpulse/tasks/other-task/abc", TASK));
});

test("validatePublicId rejects path traversal + nested paths", () => {
  assert.ok(!cld.validatePublicId("devpulse/tasks/task-123/../evil", TASK));
  assert.ok(!cld.validatePublicId(`${FOLDER}/a/b`, TASK));
  assert.ok(!cld.validatePublicId("", TASK));
});

test("newPublicId returns a unique, unguessable id each call", () => {
  const a = cld.newPublicId();
  const b = cld.newPublicId();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/); // uuid v4 shape
});

test("isConfigured is false without Cloudinary credentials in tests", () => {
  // Guards that the endpoints correctly return 503 when unconfigured.
  assert.equal(cld.isConfigured(), false);
});
