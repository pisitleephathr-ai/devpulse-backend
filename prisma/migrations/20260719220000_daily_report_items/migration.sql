-- Additive, non-destructive: per-task report items (work + progress% + note).
-- The existing DailyReport free-text columns (did/plan/blockers/summary) stay in
-- place and are kept in sync (derived) from items, so every existing consumer
-- (standup, dashboard, LINE summary, search) keeps working. Existing reports have
-- no items — they continue to render from their text fields.

CREATE TABLE "DailyReportItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportId" TEXT NOT NULL,
    "taskId" TEXT,

    CONSTRAINT "DailyReportItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DailyReportItem_reportId_idx" ON "DailyReportItem"("reportId");
CREATE INDEX "DailyReportItem_taskId_idx" ON "DailyReportItem"("taskId");

ALTER TABLE "DailyReportItem"
    ADD CONSTRAINT "DailyReportItem_reportId_fkey"
    FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyReportItem"
    ADD CONSTRAINT "DailyReportItem_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
