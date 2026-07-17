-- Additive, non-destructive: per-role sidebar menu visibility.
-- Empty array = inherit the built-in defaults for the role code, so every
-- existing role keeps its current menu visibility until explicitly configured.
ALTER TABLE "Role" ADD COLUMN "menuAccess" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
