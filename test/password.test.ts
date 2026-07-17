import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/lib/password";

test("hashPassword produces a verifiable, non-plaintext hash", async () => {
  const hash = await hashPassword("s3cret-pass");
  assert.notEqual(hash, "s3cret-pass");
  assert.equal(await verifyPassword("s3cret-pass", hash), true);
  assert.equal(await verifyPassword("wrong-pass", hash), false);
});

test("the same password hashes differently each time (salted)", async () => {
  const [a, b] = await Promise.all([
    hashPassword("same-input"),
    hashPassword("same-input"),
  ]);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-input", a), true);
  assert.equal(await verifyPassword("same-input", b), true);
});
