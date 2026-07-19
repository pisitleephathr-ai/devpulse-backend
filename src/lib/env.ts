import { z } from "zod";

/** Validate and expose environment variables. Fails fast on misconfig. */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  CORS_ORIGIN: z.string().default("*"),
  // Public frontend URL, used to build "open task" links in LINE cards.
  // Falls back to CORS_ORIGIN when it's a single URL.
  APP_URL: z.string().optional(),
  // LINE Official Account push notifications (optional; disabled by default).
  // When LINE_ENABLED is true, task notifications are also pushed to the team's
  // LINE group (LINE_GROUP_ID) via the Messaging API channel access token.
  LINE_ENABLED: z.coerce.boolean().default(false),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  // Channel secret — used to verify the X-Line-Signature on incoming webhooks
  // (required for auto-capturing the group id).
  LINE_CHANNEL_SECRET: z.string().optional(),
  // Optional manual override; when empty the group id is auto-captured from a
  // webhook event and stored on TeamSetting.lineGroupId.
  LINE_GROUP_ID: z.string().optional(),
  // Optional add-friend URL for the OA (e.g. https://line.me/R/ti/p/@basicid),
  // shown on the profile page so users can add the bot before linking. Purely
  // informational — linking works without it.
  LINE_ADD_FRIEND_URL: z.string().optional(),
  // Shared secret for the external-cron endpoint (POST /api/cron/line-summaries).
  // When set, callers must present it; lets an external scheduler drive the
  // daily summaries even while the server would otherwise be idle/asleep.
  CRON_SECRET: z.string().optional(),
  // Cloudinary — signed direct upload for task attachments (optional; the
  // attachment-upload endpoints return 503 until all three are configured).
  // The API secret is server-only and must NEVER be exposed to the frontend,
  // logged, or returned in any response.
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  // Root folder for uploaded assets; per-task assets live under
  // `${CLOUDINARY_UPLOAD_FOLDER}/tasks/{taskId}`.
  CLOUDINARY_UPLOAD_FOLDER: z.string().default("devpulse"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
