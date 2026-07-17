import { test, before } from "node:test";
import assert from "node:assert/strict";

// jwt.ts imports env.ts, which validates process.env at load and exits on
// misconfig. Provide safe defaults (only if the CI env hasn't already set them)
// BEFORE the module loads. Import happens in a `before` hook — not top-level —
// because this package compiles as CommonJS, where top-level await is illegal.
process.env.DATABASE_URL ??=
  "postgresql://user:pass@localhost:5432/devpulse_test?schema=public";
process.env.JWT_SECRET ??= "test-secret-that-is-at-least-16-characters";
process.env.NODE_ENV ??= "test";

let signToken: (payload: { sub: string; role: string }) => string;
let verifyToken: (token: string) => { sub: string; role: string };

before(async () => {
  ({ signToken, verifyToken } = await import("../src/lib/jwt"));
});

test("signToken/verifyToken round-trips the payload", () => {
  const token = signToken({ sub: "user-1", role: "ADMIN" });
  const payload = verifyToken(token);
  assert.equal(payload.sub, "user-1");
  assert.equal(payload.role, "ADMIN");
});

test("verifyToken rejects a tampered token", () => {
  const token = signToken({ sub: "user-2", role: "DEVELOPER" });
  assert.throws(() => verifyToken(token + "tampered"));
});

test("verifyToken rejects a token signed with a different secret", async () => {
  const jwt = (await import("jsonwebtoken")).default;
  const forged = jwt.sign({ sub: "x", role: "ADMIN" }, "some-other-secret-16ch");
  assert.throws(() => verifyToken(forged));
});
