-- Board workflow rework (additive / non-destructive).
--  * Remap the TaskStatus enum to the dev→delivery pipeline. RENAME keeps all
--    existing rows valid (REVIEW→DEV_REVIEW, READY_TO_TEST→DEV_DONE,
--    DONE→DELIVERY_DONE) and adds the new DELIVERY_FAIL terminal state.
--  * New Task timestamp/planning columns + handoff (tester) + rework origin.

ALTER TYPE "TaskStatus" RENAME VALUE 'REVIEW' TO 'DEV_REVIEW';
ALTER TYPE "TaskStatus" RENAME VALUE 'READY_TO_TEST' TO 'DEV_DONE';
ALTER TYPE "TaskStatus" RENAME VALUE 'DONE' TO 'DELIVERY_DONE';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'DELIVERY_FAIL' AFTER 'DELIVERY_DONE';

ALTER TABLE "Task"
    ADD COLUMN "estimatedFinishAt" TIMESTAMP(3),
    ADD COLUMN "startedAt" TIMESTAMP(3),
    ADD COLUMN "devDoneAt" TIMESTAMP(3),
    ADD COLUMN "handoffUserId" TEXT,
    ADD COLUMN "originTaskId" TEXT;

CREATE INDEX "Task_handoffUserId_idx" ON "Task"("handoffUserId");
CREATE INDEX "Task_originTaskId_idx" ON "Task"("originTaskId");

ALTER TABLE "Task"
    ADD CONSTRAINT "Task_handoffUserId_fkey" FOREIGN KEY ("handoffUserId")
        REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "Task_originTaskId_fkey" FOREIGN KEY ("originTaskId")
        REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Remap the stored LINE status-notify preferences (a String[]) to the new names
-- so existing teams keep notifying on the equivalent statuses.
UPDATE "TeamSetting" SET "lineNotifyStatuses" = (
  SELECT array_agg(
    CASE v
      WHEN 'REVIEW' THEN 'DEV_REVIEW'
      WHEN 'READY_TO_TEST' THEN 'DEV_DONE'
      WHEN 'DONE' THEN 'DELIVERY_DONE'
      ELSE v
    END
  )
  FROM unnest("lineNotifyStatuses") AS v
)
WHERE "lineNotifyStatuses" && ARRAY['REVIEW','READY_TO_TEST','DONE'];

ALTER TABLE "TeamSetting"
    ALTER COLUMN "lineNotifyStatuses" SET DEFAULT ARRAY['TODO', 'DELIVERY_DONE'];
