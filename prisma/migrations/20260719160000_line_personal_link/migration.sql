-- Additive, non-destructive: enable per-user personal LINE messaging.
--
-- Adds a nullable LINE user id + linked-at timestamp on User (existing rows stay
-- valid, unlinked), and a LineLinkCode table backing the "generate a code, send
-- it to the OA in a 1:1 chat" account-linking handshake. No existing data is
-- touched and nothing is dropped.

-- AlterTable: per-user personal LINE identity (both additive/nullable)
ALTER TABLE "User"
    ADD COLUMN "lineUserId" TEXT,
    ADD COLUMN "lineLinkedAt" TIMESTAMP(3);

-- CreateIndex: at most one user per LINE id (nullable → many unlinked NULLs allowed)
CREATE UNIQUE INDEX "User_lineUserId_key" ON "User"("lineUserId");

-- CreateTable
CREATE TABLE "LineLinkCode" (
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineLinkCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "LineLinkCode_userId_key" ON "LineLinkCode"("userId");

-- CreateIndex
CREATE INDEX "LineLinkCode_expiresAt_idx" ON "LineLinkCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "LineLinkCode"
    ADD CONSTRAINT "LineLinkCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
