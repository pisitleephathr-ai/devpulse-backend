-- Additive: weekly highlight reel ("what the team shipped this week") → LINE
-- group, sent on Mondays. Toggle + time + per-day last-run dedup guard.

ALTER TABLE "TeamSetting"
    ADD COLUMN "lineWeeklyHighlight" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "lineWeeklyHighlightTime" TEXT NOT NULL DEFAULT '09:00',
    ADD COLUMN "lineWeeklyHighlightLastRun" TEXT;
