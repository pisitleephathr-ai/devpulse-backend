-- Additive: split report items into two sections — "DID" (งานที่ทำล่าสุด) and
-- "PLAN" (แผนงานวันนี้). Existing items default to DID (they were "what I did").

ALTER TABLE "DailyReportItem"
    ADD COLUMN "section" TEXT NOT NULL DEFAULT 'DID';
