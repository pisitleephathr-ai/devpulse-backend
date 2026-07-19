-- Additive, non-destructive: team kudos (public shout-outs). No existing table
-- is touched.

CREATE TABLE "Kudos" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,

    CONSTRAINT "Kudos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Kudos_toUserId_idx" ON "Kudos"("toUserId");
CREATE INDEX "Kudos_createdAt_idx" ON "Kudos"("createdAt");

ALTER TABLE "Kudos"
    ADD CONSTRAINT "Kudos_fromUserId_fkey"
    FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Kudos"
    ADD CONSTRAINT "Kudos_toUserId_fkey"
    FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
