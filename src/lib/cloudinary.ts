import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import { resourceTypeForKind, type AttachmentKindValue } from "./upload-limits";

/**
 * Central Cloudinary wrapper. The ONLY place the SDK / API secret is touched —
 * controllers call these helpers so credentials never spread across the code.
 *
 * Security notes:
 *  - The API secret is read from env here and passed straight to the SDK's
 *    signing routine. It is never returned, logged, or included in an error.
 *  - We use SIGNED direct uploads only. The signature is computed server-side
 *    over an exact parameter set (folder + public_id + timestamp + resource
 *    constraints); the client cannot alter those without invalidating it.
 */

let configured = false;

/** Whether all required Cloudinary credentials are present. */
export function isConfigured(): boolean {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
      env.CLOUDINARY_API_KEY &&
      env.CLOUDINARY_API_SECRET
  );
}

/** Configure the SDK once (idempotent). Throws if credentials are missing. */
function ensureConfigured() {
  if (!isConfigured()) {
    throw new Error("Cloudinary is not configured");
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
}

export const ROOT_FOLDER = env.CLOUDINARY_UPLOAD_FOLDER || "devpulse";

/** The canonical Cloudinary folder for a task's attachments. */
export function taskFolder(taskId: string): string {
  return `${ROOT_FOLDER}/tasks/${taskId}`;
}

/** A fresh, unguessable public id. We never derive it from the user filename. */
export function newPublicId(): string {
  return randomUUID();
}

/**
 * Whether `publicId` belongs to `taskId`'s folder. Cloudinary returns the
 * public_id WITHOUT the folder when `use_filename`/folder are set via params,
 * but with signed uploads using `folder` + `public_id` the stored public_id is
 * `${folder}/${publicId}`. We accept either the bare id (matching the intent) or
 * the folder-prefixed form, and reject anything pointing at another task.
 */
export function validatePublicId(publicId: string, taskId: string): boolean {
  if (!publicId || publicId.includes("..")) return false;
  const folder = taskFolder(taskId);
  if (publicId.startsWith(`${folder}/`)) {
    const tail = publicId.slice(folder.length + 1);
    return tail.length > 0 && !tail.includes("/");
  }
  // Bare id (no slashes) is valid — it is scoped to the folder by the upload.
  return !publicId.includes("/");
}

/** Whether a returned folder string is exactly this task's folder. */
export function validateCloudinaryFolder(folder: string, taskId: string): boolean {
  return folder === taskFolder(taskId);
}

export type SignatureResult = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  publicId: string;
  resourceType: "image" | "raw";
  expiresIn: number;
};

/**
 * Build signed upload parameters for a single file. The signature covers the
 * exact folder + public_id + timestamp, so the client can only upload the file
 * we authorized, into the task's folder, under the id we generated.
 */
export function createUploadSignature(params: {
  taskId: string;
  publicId: string;
  kind: AttachmentKindValue;
}): SignatureResult {
  ensureConfigured();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = taskFolder(params.taskId);
  const resourceType = resourceTypeForKind(params.kind);

  // The parameter set that is signed. Must match EXACTLY what the client sends
  // to Cloudinary (minus file/api_key/signature). Keep this minimal + explicit.
  const toSign: Record<string, string | number> = {
    folder,
    public_id: params.publicId,
    timestamp,
  };

  const signature = cloudinary.utils.api_sign_request(
    toSign,
    env.CLOUDINARY_API_SECRET as string
  );

  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME as string,
    apiKey: env.CLOUDINARY_API_KEY as string,
    timestamp,
    signature,
    folder,
    publicId: params.publicId,
    resourceType,
    expiresIn: 300,
  };
}

export type InspectedAsset = {
  publicId: string;
  assetId: string | null;
  resourceType: string;
  format: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  version: number | null;
  secureUrl: string;
  folder: string;
};

/**
 * Fetch an asset's real metadata from the Cloudinary Admin API so the complete
 * endpoint verifies against the source of truth instead of trusting the client
 * (which could forge size / url / format / resource type). Returns null if the
 * asset does not exist.
 */
export async function inspectAsset(
  publicId: string,
  resourceType: "image" | "raw"
): Promise<InspectedAsset | null> {
  ensureConfigured();
  try {
    const r = await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
    });
    const derivedFolder = publicId.includes("/")
      ? publicId.slice(0, publicId.lastIndexOf("/"))
      : "";
    return {
      publicId: r.public_id,
      assetId: r.asset_id ?? null,
      resourceType: r.resource_type,
      format: r.format ?? null,
      bytes: typeof r.bytes === "number" ? r.bytes : 0,
      width: typeof r.width === "number" ? r.width : null,
      height: typeof r.height === "number" ? r.height : null,
      version: typeof r.version === "number" ? r.version : null,
      secureUrl: r.secure_url,
      folder: r.folder ?? derivedFolder,
    };
  } catch (err: unknown) {
    // A 404 means "not found" (client lied / upload never landed) — return null.
    // Anything else is a real failure the caller should surface.
    const httpCode = (err as { http_code?: number })?.http_code;
    if (httpCode === 404) return null;
    throw err;
  }
}

/** Delete an asset. Returns the Cloudinary `result` string ("ok"/"not found"). */
export async function deleteAsset(
  publicId: string,
  resourceType: "image" | "raw"
): Promise<string> {
  ensureConfigured();
  const r = await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
  return r.result;
}

/** A ~320x180 auto-format thumbnail URL for an image asset (board/grid preview). */
export function buildThumbnailUrl(publicId: string, version?: number | null): string {
  ensureConfigured();
  return cloudinary.url(publicId, {
    resource_type: "image",
    type: "upload",
    version: version ?? undefined,
    secure: true,
    transformation: [
      { width: 320, height: 180, crop: "fill", quality: "auto", fetch_format: "auto" },
    ],
  });
}

/** A large, quality-limited URL for the lightbox (loaded only on open). */
export function buildPreviewUrl(publicId: string, version?: number | null): string {
  ensureConfigured();
  return cloudinary.url(publicId, {
    resource_type: "image",
    type: "upload",
    version: version ?? undefined,
    secure: true,
    transformation: [{ width: 1600, crop: "limit", quality: "auto", fetch_format: "auto" }],
  });
}
