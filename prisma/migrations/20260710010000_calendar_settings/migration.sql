-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('LEAVE', 'DEADLINE');

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "type" "CalendarEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveTypePolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysLabel" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveTypePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSetting" (
    "id" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "reportReminderTime" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_startDate_idx" ON "CalendarEvent"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveTypePolicy_name_key" ON "LeaveTypePolicy"("name");

