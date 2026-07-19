import { test } from "node:test";
import assert from "node:assert/strict";
import { generateLinkCode, LINK_CODE_TTL_MS } from "../src/lib/line-link";

// The generator is pure (crypto only); the DB-backed issue/link/unlink helpers
// are covered by the end-to-end flow on a live LINE OA.

test("generateLinkCode: 6 chars from the unambiguous uppercase alphabet", () => {
  const allowed = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
  for (let i = 0; i < 500; i++) {
    const code = generateLinkCode();
    assert.match(code, allowed, `unexpected code: ${code}`);
  }
});

test("generateLinkCode: excludes ambiguous characters (0 O 1 I L)", () => {
  for (let i = 0; i < 500; i++) {
    const code = generateLinkCode();
    assert.ok(!/[0O1IL]/.test(code), `ambiguous char in: ${code}`);
  }
});

test("generateLinkCode: reasonably varied (not a constant)", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(generateLinkCode());
  // 200 draws over ~1e9 space should give many distinct values.
  assert.ok(seen.size > 150, `too few distinct codes: ${seen.size}`);
});

test("LINK_CODE_TTL_MS is 10 minutes", () => {
  assert.equal(LINK_CODE_TTL_MS, 10 * 60 * 1000);
});
