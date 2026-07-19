-- Additive, non-destructive: standup action items. Items raised during a daily
-- standup are tracked to completion; open ones are carried forward into later
-- standups. No existing table is touched.

CREATE TYPE "ActionItemStatus" AS ENUM ('OPEN', 'DONE');

CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "ActionItemStatus" NOT NULL DEFAULT 'OPEN',
    "date" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActionItem_status_idx" ON "ActionItem"("status");
CREATE INDEX "ActionItem_date_idx" ON "ActionItem"("date");

ALTER TABLE "ActionItem"
    ADD CONSTRAINT "ActionItem_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActionItem"
    ADD CONSTRAINT "ActionItem_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
