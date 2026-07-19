-- Additive: team-wide master switch for personal LINE DMs. Defaults on so
-- current behavior is unchanged; an admin can turn all personal notifications
-- off from Settings without affecting group summaries/cards.

ALTER TABLE "TeamSetting"
    ADD COLUMN "linePersonalEnabled" BOOLEAN NOT NULL DEFAULT true;
