-- Additive, non-destructive migration.
-- Adds: leave-type archive flag, half-day leave support, company holidays,
-- and organization settings fields. No data is dropped or reset.

-- Leave type archive flag
ALTER TABLE "LeaveTypePolicy" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Half-day leave: widen day count to allow 0.5, record which half
ALTER TABLE "LeaveRequest" ALTER COLUMN "days" TYPE DOUBLE PRECISION;
ALTER TABLE "LeaveRequest" ADD COLUMN "halfDayPeriod" TEXT;

-- Organization settings expansion (safe defaults for the existing row)
ALTER TABLE "TeamSetting" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok';
ALTER TABLE "TeamSetting" ADD COLUMN "workingDays" TEXT NOT NULL DEFAULT '1,2,3,4,5';
ALTER TABLE "TeamSetting" ADD COLUMN "reportDueTime" TEXT NOT NULL DEFAULT '08:30';
ALTER TABLE "TeamSetting" ADD COLUMN "requireDailyReportDefault" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TeamSetting" ADD COLUMN "allowHalfDayLeave" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TeamSetting" ADD COLUMN "notifyReportReminder" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TeamSetting" ADD COLUMN "notifyLeaveApproval" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TeamSetting" ADD COLUMN "notifyTaskDue" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TeamSetting" ADD COLUMN "menuOrder" TEXT NOT NULL DEFAULT '';

-- Company holidays
CREATE TABLE "CompanyHoliday" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'COMPANY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyHoliday_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyHoliday_date_idx" ON "CompanyHoliday"("date");
