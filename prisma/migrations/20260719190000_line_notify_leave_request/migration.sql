-- Additive: per-user pref for the "new leave request" DM (sent to approvers).
-- Defaults true so approvers keep getting notified until they opt out.

ALTER TABLE "User"
    ADD COLUMN "lineNotifyLeaveRequest" BOOLEAN NOT NULL DEFAULT true;
