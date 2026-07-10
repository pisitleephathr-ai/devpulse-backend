// Dependency-free API smoke tests (Node 18+ built-in test runner + fetch).
// Run against the deployed API or a local server:
//   API_BASE=http://localhost:4000 npm test
// Optional creds (defaults to the seeded demo account):
//   SMOKE_EMAIL=boss@devpulse.io SMOKE_PASSWORD=password123
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE =
  process.env.API_BASE ??
  "https://devpulse-backend-production-a216.up.railway.app";
const EMAIL = process.env.SMOKE_EMAIL ?? "boss@devpulse.io";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "password123";

const api = (path, opts = {}) =>
  fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });

test("health endpoint is up", async () => {
  const res = await api("/api/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
});

test("protected route requires a token (401)", async () => {
  const res = await api("/api/tasks");
  assert.equal(res.status, 401);
});

test("login fails with wrong credentials (401)", async () => {
  const res = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: "definitely-wrong" }),
  });
  assert.equal(res.status, 401);
});

test("login succeeds and token unlocks protected routes", async () => {
  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.ok(token, "expected a JWT");

  const tasks = await api("/api/tasks", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(tasks.status, 200);
  const body = await tasks.json();
  assert.ok(Array.isArray(body.tasks));
});
