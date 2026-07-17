-- Additive, non-destructive: LINE leave notifications + daily summaries config.
ALTER TABLE "TeamSetting" ADD COLUMN "lineNotifyLeave" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TeamSetting" ADD COLUMN "lineDailyLeaveSummary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamSetting" ADD COLUMN "lineDailyLeaveSummaryTime" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "TeamSetting" ADD COLUMN "lineDailyReportSummary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamSetting" ADD COLUMN "lineDailyReportSummaryTime" TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE "TeamSetting" ADD COLUMN "lineLeaveSummaryLastRun" TEXT;
ALTER TABLE "TeamSetting" ADD COLUMN "lineReportSummaryLastRun" TEXT;
