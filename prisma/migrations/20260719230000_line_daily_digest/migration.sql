-- Additive: personal morning digest DM (overdue + due today/tomorrow).
--  * User.lineNotifyDailyDigest — per-user opt-in (default on).
--  * TeamSetting digest toggle + time + last-run guard (off by default).

ALTER TABLE "User"
    ADD COLUMN "lineNotifyDailyDigest" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "TeamSetting"
    ADD COLUMN "lineDailyDigest" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "lineDailyDigestTime" TEXT NOT NULL DEFAULT '08:30',
    ADD COLUMN "lineDailyDigestLastRun" TEXT;
