-- AddColumn: existing users default to requiring a daily report (safe, non-destructive)
ALTER TABLE "User" ADD COLUMN "requiresDailyReport" BOOLEAN NOT NULL DEFAULT true;
