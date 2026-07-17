-- AlterTable: add capability grants to roles (additive, non-breaking)
ALTER TABLE "Role" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill the system roles so their capabilities are explicit in data too.
-- (The legacy ADMIN/MANAGER codes already grant access via code-match, so this
-- changes no behavior — it just keeps the permission data consistent.)
UPDATE "Role" SET "permissions" = ARRAY['ADMIN_FULL', 'TEAM_MANAGE'] WHERE "code" = 'ADMIN';
UPDATE "Role" SET "permissions" = ARRAY['TEAM_MANAGE'] WHERE "code" = 'MANAGER';
