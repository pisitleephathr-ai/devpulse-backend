/**
 * Single source of truth for task-attachment upload limits and allowlists.
 * The frontend fetches these via GET /api/uploads/config and must not hardcode
 * its own values (only fall back to a copy when the backend is unreachable).
 * Every rule enforced here on the client is ALSO enforced server-side in the
 * signature + complete endpoints — the client checks are UX only.
 */

export const UPLOAD_LIMITS = {
  imageMaxBytes: 5 * 1024 * 1024, // 5 MB
  documentMaxBytes: 10 * 1024 * 1024, // 10 MB
  maxFilesPerTask: 20,
  maxTotalBytesPerTask: 100 * 1024 * 1024, // 100 MB
  maxConcurrentUploads: 5,
} as const;

/** Allowed image MIME types. Note: SVG/BMP/TIFF are intentionally excluded
 * (SVG can carry active content; BMP/TIFF are unnecessary here). */
export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
] as const;

export const ALLOWED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".pdf",
  ".txt",
  ".csv",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
] as const;

/** Extensions that must be treated as images (drives resource_type = image). */
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export type AttachmentKindValue = "IMAGE" | "DOCUMENT";

/** The public shape returned by GET /api/uploads/config. */
export function uploadConfig() {
  return {
    limits: {
      imageMaxBytes: UPLOAD_LIMITS.imageMaxBytes,
      documentMaxBytes: UPLOAD_LIMITS.documentMaxBytes,
      maxFilesPerTask: UPLOAD_LIMITS.maxFilesPerTask,
      maxTotalBytesPerTask: UPLOAD_LIMITS.maxTotalBytesPerTask,
      maxConcurrentUploads: UPLOAD_LIMITS.maxConcurrentUploads,
    },
    allowed: {
      imageMimeTypes: [...IMAGE_MIME_TYPES],
      documentMimeTypes: [...DOCUMENT_MIME_TYPES],
      extensions: [...ALLOWED_EXTENSIONS],
    },
  };
}

/** Lowercased extension including the dot, e.g. "report.PDF" -> ".pdf". "" if none. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot).toLowerCase();
}

export function isImageMime(mime: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

export function isDocumentMime(mime: string): boolean {
  return (DOCUMENT_MIME_TYPES as readonly string[]).includes(mime);
}

export function isAllowedExtension(ext: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

/** Whether an extension denotes an image (for resource-type selection). */
export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

/** Classify a MIME type, or null if it is not on any allowlist. */
export function kindForMime(mime: string): AttachmentKindValue | null {
  if (isImageMime(mime)) return "IMAGE";
  if (isDocumentMime(mime)) return "DOCUMENT";
  return null;
}

/** The per-file byte ceiling for a given kind. */
export function maxBytesForKind(kind: AttachmentKindValue): number {
  return kind === "IMAGE"
    ? UPLOAD_LIMITS.imageMaxBytes
    : UPLOAD_LIMITS.documentMaxBytes;
}

/** Cloudinary resource_type for a kind: images use "image", everything else "raw". */
export function resourceTypeForKind(kind: AttachmentKindValue): "image" | "raw" {
  return kind === "IMAGE" ? "image" : "raw";
}

/**
 * Validate a declared file (name + mime + size) against the allowlists and
 * per-file size limit. Returns the resolved kind on success, or a Thai error
 * message describing the first failing rule. Shared by signature + complete so
 * the rules can never drift between the two endpoints.
 */
export function validateFileMeta(input: {
  fileName: string;
  mimeType: string;
  fileSize: number;
}):
  | { ok: true; kind: AttachmentKindValue; extension: string }
  | { ok: false; error: string } {
  const name = input.fileName.trim();
  if (!name) return { ok: false, error: "ชื่อไฟล์ว่างไม่ได้" };

  const kind = kindForMime(input.mimeType);
  if (!kind) {
    return { ok: false, error: `ไม่รองรับไฟล์ประเภท ${input.mimeType || "ไม่ทราบ"}` };
  }

  const ext = extensionOf(name);
  if (!ext || !isAllowedExtension(ext)) {
    return { ok: false, error: `ไม่รองรับไฟล์นามสกุล ${ext || "(ไม่มีนามสกุล)"}` };
  }

  // The extension family must match the MIME family (an image mime must carry an
  // image extension, and vice versa) so a mislabeled upload can't slip through.
  const extIsImage = isImageExtension(ext);
  if (kind === "IMAGE" && !extIsImage) {
    return { ok: false, error: "ชนิดไฟล์และนามสกุลไม่ตรงกัน" };
  }
  if (kind === "DOCUMENT" && extIsImage) {
    return { ok: false, error: "ชนิดไฟล์และนามสกุลไม่ตรงกัน" };
  }

  const max = maxBytesForKind(kind);
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, error: "ขนาดไฟล์ไม่ถูกต้อง" };
  }
  if (input.fileSize > max) {
    return {
      ok: false,
      error: `ไฟล์ ${name} มีขนาด ${mb(input.fileSize)} เกินขนาดสูงสุดสำหรับ${
        kind === "IMAGE" ? "รูปภาพ" : "เอกสาร"
      } ${mb(max)}`,
    };
  }

  return { ok: true, kind, extension: ext };
}

/** Human MB, one decimal, for error messages. */
function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
