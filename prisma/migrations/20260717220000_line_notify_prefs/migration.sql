-- Additive, non-destructive: per-team LINE notification preferences.
ALTER TABLE "TeamSetting" ADD COLUMN "lineNotifyNewTask" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TeamSetting" ADD COLUMN "lineNotifyStatuses" TEXT[] NOT NULL DEFAULT ARRAY['TODO', 'DONE']::TEXT[];
