-- CreateTable
CREATE TABLE "DailyReportRelatedTask" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "reportId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "DailyReportRelatedTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyReportRelatedTask_reportId_idx" ON "DailyReportRelatedTask"("reportId");

-- CreateIndex
CREATE INDEX "DailyReportRelatedTask_taskId_idx" ON "DailyReportRelatedTask"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReportRelatedTask_reportId_taskId_key" ON "DailyReportRelatedTask"("reportId", "taskId");

-- AddForeignKey
ALTER TABLE "DailyReportRelatedTask" ADD CONSTRAINT "DailyReportRelatedTask_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReportRelatedTask" ADD CONSTRAINT "DailyReportRelatedTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
