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
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
