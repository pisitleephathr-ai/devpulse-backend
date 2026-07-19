-- Additive, non-destructive:
--  * Task.completedAt — timestamp a task first reached DONE, for on-time metrics.
--    Existing DONE tasks stay NULL (not back-filled) — metrics count forward.
--  * User.lineNotifyTaskStatus / lineNotifyMention — two more personal-DM prefs
--    (default true).
--  * TeamSetting weekly team-performance summary fields (off by default).

ALTER TABLE "Task"
    ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "User"
    ADD COLUMN "lineNotifyTaskStatus" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "lineNotifyMention" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "TeamSetting"
    ADD COLUMN "lineWeeklyPerformance" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "lineWeeklyPerformanceTime" TEXT NOT NULL DEFAULT '09:00',
    ADD COLUMN "lineWeeklyPerformanceLastRun" TEXT;
