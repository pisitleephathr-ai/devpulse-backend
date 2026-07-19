-- Additive, non-destructive: per-role allow list for personal-LINE notification
-- types. Empty (the default) means all types are allowed, so existing roles keep
-- their current behavior until an admin narrows the list.

ALTER TABLE "Role"
    ADD COLUMN "lineNotifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
