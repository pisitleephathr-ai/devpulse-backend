-- Additive, non-destructive: sidebar menu customization JSON (display only).
ALTER TABLE "TeamSetting" ADD COLUMN "menuConfig" TEXT NOT NULL DEFAULT '';
