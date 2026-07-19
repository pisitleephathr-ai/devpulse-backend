import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateFileMeta,
  kindForMime,
  extensionOf,
  maxBytesForKind,
  resourceTypeForKind,
  isAllowedExtension,
  uploadConfig,
  UPLOAD_LIMITS,
} from "../src/lib/upload-limits";

test("extensionOf lowercases and requires a real extension", () => {
  assert.equal(extensionOf("report.PDF"), ".pdf");
  assert.equal(extensionOf("a.b.PNG"), ".png");
  assert.equal(extensionOf("noext"), "");
  assert.equal(extensionOf(".dotfile"), "");
  assert.equal(extensionOf("trailingdot."), "");
});

test("kindForMime classifies allowlisted types and rejects others", () => {
  assert.equal(kindForMime("image/png"), "IMAGE");
  assert.equal(kindForMime("image/webp"), "IMAGE");
  assert.equal(kindForMime("application/pdf"), "DOCUMENT");
  assert.equal(kindForMime("application/vnd.ms-excel"), "DOCUMENT");
  assert.equal(kindForMime("image/svg+xml"), null); // explicitly excluded
  assert.equal(kindForMime("text/html"), null);
  assert.equal(kindForMime("application/javascript"), null);
});

test("maxBytes + resourceType per kind", () => {
  assert.equal(maxBytesForKind("IMAGE"), 5 * 1024 * 1024);
  assert.equal(maxBytesForKind("DOCUMENT"), 10 * 1024 * 1024);
  assert.equal(resourceTypeForKind("IMAGE"), "image");
  assert.equal(resourceTypeForKind("DOCUMENT"), "raw");
});

test("isAllowedExtension rejects dangerous/unknown extensions", () => {
  assert.ok(isAllowedExtension(".png"));
  assert.ok(isAllowedExtension(".XLSX"));
  assert.ok(!isAllowedExtension(".exe"));
  assert.ok(!isAllowedExtension(".svg"));
  assert.ok(!isAllowedExtension(".js"));
});

test("validateFileMeta accepts a valid image", () => {
  const r = validateFileMeta({
    fileName: "bug-login.png",
    mimeType: "image/png",
    fileSize: 814322,
  });
  assert.ok(r.ok && r.kind === "IMAGE" && r.extension === ".png");
});

test("validateFileMeta accepts a valid document", () => {
  const r = validateFileMeta({
    fileName: "requirement-v2.pdf",
    mimeType: "application/pdf",
    fileSize: 2_400_000,
  });
  assert.ok(r.ok && r.kind === "DOCUMENT");
});

test("validateFileMeta rejects an empty name", () => {
  const r = validateFileMeta({ fileName: "  ", mimeType: "image/png", fileSize: 10 });
  assert.ok(!r.ok);
});

test("validateFileMeta rejects unsupported mime", () => {
  const r = validateFileMeta({
    fileName: "x.svg",
    mimeType: "image/svg+xml",
    fileSize: 10,
  });
  assert.ok(!r.ok);
});

test("validateFileMeta rejects unsupported extension even with ok mime", () => {
  const r = validateFileMeta({
    fileName: "malware.exe",
    mimeType: "application/pdf",
    fileSize: 10,
  });
  assert.ok(!r.ok);
});

test("validateFileMeta rejects mime/extension mismatch", () => {
  const r = validateFileMeta({
    fileName: "photo.pdf",
    mimeType: "image/png",
    fileSize: 10,
  });
  assert.ok(!r.ok);
});

test("validateFileMeta rejects an oversize image (>5MB)", () => {
  const r = validateFileMeta({
    fileName: "big.png",
    mimeType: "image/png",
    fileSize: 5 * 1024 * 1024 + 1,
  });
  assert.ok(!r.ok && /เกินขนาด/.test(r.error));
});

test("validateFileMeta rejects an oversize document (>10MB)", () => {
  const r = validateFileMeta({
    fileName: "big.pdf",
    mimeType: "application/pdf",
    fileSize: 10 * 1024 * 1024 + 1,
  });
  assert.ok(!r.ok);
});

test("validateFileMeta rejects a zero/negative size", () => {
  assert.ok(!validateFileMeta({ fileName: "a.png", mimeType: "image/png", fileSize: 0 }).ok);
});

test("uploadConfig exposes the documented limits + allowlists", () => {
  const c = uploadConfig();
  assert.equal(c.limits.imageMaxBytes, UPLOAD_LIMITS.imageMaxBytes);
  assert.equal(c.limits.maxFilesPerTask, 20);
  assert.equal(c.limits.maxTotalBytesPerTask, 104857600);
  assert.equal(c.limits.maxConcurrentUploads, 5);
  assert.ok(c.allowed.imageMimeTypes.includes("image/png"));
  assert.ok(!c.allowed.imageMimeTypes.includes("image/svg+xml"));
  assert.ok(c.allowed.documentMimeTypes.includes("application/pdf"));
  assert.ok(c.allowed.extensions.includes(".xlsx"));
});
