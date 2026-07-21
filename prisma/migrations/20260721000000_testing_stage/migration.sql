-- Additive: a TESTING stage between DEV_DONE and delivery (tester actively
-- testing), plus the actual test-start timestamp. Existing rows are unaffected.

ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'TESTING' AFTER 'DEV_DONE';

ALTER TABLE "Task" ADD COLUMN "testStartedAt" TIMESTAMP(3);
