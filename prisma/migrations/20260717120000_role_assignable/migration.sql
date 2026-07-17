-- Additive, non-destructive: per-role "appears on the task board" flag.
-- Drives who can be assigned tasks and who shows in the team-workload list.
ALTER TABLE "Role" ADD COLUMN "assignable" BOOLEAN NOT NULL DEFAULT true;

-- System-admin roles are not task workers by default, so keep them off the
-- board. Managers/members stay assignable. Admins can be re-enabled from the
-- roles settings page at any time.
UPDATE "Role" SET "assignable" = false WHERE "code" = 'ADMIN';
