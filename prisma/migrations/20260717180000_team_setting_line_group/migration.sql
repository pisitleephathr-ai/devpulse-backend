-- Additive, non-destructive: store the auto-captured LINE group id on the
-- singleton TeamSetting so task notifications know where to push.
ALTER TABLE "TeamSetting" ADD COLUMN "lineGroupId" TEXT;
