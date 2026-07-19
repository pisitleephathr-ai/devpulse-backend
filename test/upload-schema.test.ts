import { test } from "node:test";
import assert from "node:assert/strict";
import { signatureSchema, completeSchema } from "../src/schemas/upload.schema";
import { PERMISSIONS, expandPermissions } from "../src/lib/roles";

test("signatureSchema accepts a valid request", () => {
  const r = signatureSchema.safeParse({
    fileName: "bug-login.png",
    mimeType: "image/png",
    fileSize: 814322,
  });
  assert.ok(r.success);
});

test("signatureSchema rejects an empty fileName and a non-positive size", () => {
  assert.ok(!signatureSchema.safeParse({ fileName: "", mimeType: "image/png", fileSize: 1 }).success);
  assert.ok(!signatureSchema.safeParse({ fileName: "a.png", mimeType: "image/png", fileSize: 0 }).success);
});

test("signatureSchema enforces max lengths (fileName 255, mimeType 100)", () => {
  assert.ok(
    !signatureSchema.safeParse({
      fileName: "a".repeat(256) + ".png",
      mimeType: "image/png",
      fileSize: 1,
    }).success
  );
  assert.ok(
    !signatureSchema.safeParse({
      fileName: "a.png",
      mimeType: "x".repeat(101),
      fileSize: 1,
    }).success
  );
});

test("completeSchema accepts a valid payload", () => {
  const r = completeSchema.safeParse({
    originalName: "bug-login.png",
    mimeType: "image/png",
    fileSize: 814322,
    publicId: "devpulse/tasks/t1/uuid",
    assetId: "cloud-asset-id",
    version: 1784300000,
    resourceType: "image",
    format: "png",
    secureUrl: "https://res.cloudinary.com/x/image/upload/v1/devpulse/tasks/t1/uuid.png",
    width: 1920,
    height: 1080,
  });
  assert.ok(r.success);
});

test("completeSchema rejects an invalid resourceType and a non-url secureUrl", () => {
  const base = {
    originalName: "a.png",
    mimeType: "image/png",
    fileSize: 1,
    publicId: "p",
    assetId: "a",
    resourceType: "video",
    secureUrl: "https://x/y",
  };
  assert.ok(!completeSchema.safeParse(base).success);
  assert.ok(
    !completeSchema.safeParse({ ...base, resourceType: "image", secureUrl: "not-a-url" }).success
  );
});

test("completeSchema caps secureUrl at 2048 chars", () => {
  const longUrl = "https://res.cloudinary.com/" + "a".repeat(2100);
  const r = completeSchema.safeParse({
    originalName: "a.png",
    mimeType: "image/png",
    fileSize: 1,
    publicId: "p",
    assetId: "a",
    resourceType: "image",
    secureUrl: longUrl,
  });
  assert.ok(!r.success);
});

test("manager + admin roles gain the attachment capabilities", () => {
  const mgr = expandPermissions([], "MANAGER");
  assert.ok(mgr.has(PERMISSIONS.TASK_ATTACHMENT_UPLOAD));
  assert.ok(mgr.has(PERMISSIONS.TASK_ATTACHMENT_DELETE));

  const admin = expandPermissions([], "ADMIN");
  assert.ok(admin.has(PERMISSIONS.TASK_ATTACHMENT_UPLOAD));
  assert.ok(admin.has(PERMISSIONS.TASK_ATTACHMENT_DELETE));
});

test("a plain developer role does NOT get attachment capabilities by default", () => {
  const dev = expandPermissions([], "DEVELOPER");
  assert.ok(!dev.has(PERMISSIONS.TASK_ATTACHMENT_UPLOAD));
  assert.ok(!dev.has(PERMISSIONS.TASK_ATTACHMENT_DELETE));
});

test("a fine-grained TASK_ATTACHMENT_UPLOAD grant does not imply delete", () => {
  const s = expandPermissions([PERMISSIONS.TASK_ATTACHMENT_UPLOAD], null);
  assert.ok(s.has(PERMISSIONS.TASK_ATTACHMENT_UPLOAD));
  assert.ok(!s.has(PERMISSIONS.TASK_ATTACHMENT_DELETE));
});
