import { z } from "zod";

/**
 * Zod schemas for the signed Cloudinary upload flow. Max lengths bound the
 * inputs defensively; the real allowlist/limit enforcement lives in the
 * controllers (see upload-limits.ts + cloudinary.ts), which re-check everything
 * regardless of what the client sends.
 */

/** :taskId route param for the attachment endpoints. */
export const taskIdParam = z.object({ taskId: z.string().min(1) });

/** :taskId + :attachmentId route params for delete. */
export const attachmentParams = z.object({
  taskId: z.string().min(1),
  attachmentId: z.string().min(1),
});

/** POST /:taskId/attachments/signature — request a signed upload grant. */
export const signatureSchema = z.object({
  fileName: z.string().min(1, "กรุณาระบุชื่อไฟล์").max(255, "ชื่อไฟล์ยาวเกินไป"),
  mimeType: z.string().min(1, "กรุณาระบุประเภทไฟล์").max(100),
  fileSize: z.number().int().positive("ขนาดไฟล์ไม่ถูกต้อง"),
});
export type SignatureInput = z.infer<typeof signatureSchema>;

/** POST /:taskId/attachments/complete — confirm a finished Cloudinary upload. */
export const completeSchema = z.object({
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  fileSize: z.number().int().positive(),
  publicId: z.string().min(1).max(500),
  assetId: z.string().min(1).max(255),
  version: z.number().int().nonnegative().optional(),
  resourceType: z.enum(["image", "raw"]),
  format: z.string().max(50).optional(),
  secureUrl: z.string().url().max(2048),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type CompleteInput = z.infer<typeof completeSchema>;
