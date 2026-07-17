-- Additive, non-destructive: new task-board status "READY_TO_TEST", ordered
-- between REVIEW and DONE. Existing tasks keep their current status.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'READY_TO_TEST' BEFORE 'DONE';
