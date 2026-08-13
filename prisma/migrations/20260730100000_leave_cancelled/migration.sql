-- Additive, non-destructive: add a CANCELLED value to LeaveStatus for the
-- self-service "แจ้งติดธุระ" rework (declaring = active/APPROVED immediately;
-- self-cancel-before-start = CANCELLED). No existing rows are touched.
ALTER TYPE "LeaveStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
