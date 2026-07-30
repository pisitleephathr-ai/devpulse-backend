import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateResetToken,
  hashResetToken,
  RESET_TOKEN_TTL_MS,
} from "../src/lib/password-reset";

// The token generator + hasher are pure (crypto only); the DB-backed
// issue/consume helpers are covered by the end-to-end reset flow.

test("generateResetToken: 64 hex chars (256 bits)", () => {
  const allowed = /^[0-9a-f]{64}$/;
  for (let i = 0; i < 200; i++) {
    assert.match(generateResetToken(), allowed);
  }
});

test("generateResetToken: not a constant (high entropy)", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(generateResetToken());
  assert.equal(seen.size, 200, "expected all draws distinct");
});

test("hashResetToken: deterministic sha256 hex, not the raw token", () => {
  const raw = generateResetToken();
  const h = hashResetToken(raw);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashResetToken(raw), "same input → same hash");
  assert.notEqual(h, raw, "hash must differ from the raw token");
});

test("hashResetToken: distinct tokens hash differently", () => {
  assert.notEqual(hashResetToken("a"), hashResetToken("b"));
});

test("RESET_TOKEN_TTL_MS is 1 hour", () => {
  assert.equal(RESET_TOKEN_TTL_MS, 60 * 60 * 1000);
});
