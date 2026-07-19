-- Additive, non-destructive: per-user personal-LINE DM preferences. Each column
-- defaults to true, so already-linked users keep receiving their personal
-- notifications until they opt out. Nothing is dropped or altered.

ALTER TABLE "User"
    ADD COLUMN "lineNotifyTaskAssigned" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "lineNotifyLeaveDecision" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "lineNotifyReportReminder" BOOLEAN NOT NULL DEFAULT true;
