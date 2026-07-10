-- Dynamic role management.
-- Non-destructive: the legacy "Role" enum is RENAMED (not dropped), so existing
-- User.role values are preserved and backfilled into the new Role table by a
-- one-off script (seed-roles). No data is lost.

-- Rename the legacy enum type
ALTER TYPE "Role" RENAME TO "UserRole";

-- Legacy role column becomes optional (roleId is now the source of truth)
ALTER TABLE "User" ALTER COLUMN "role" DROP NOT NULL;

-- New dynamic Role table
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- Link User -> Role
ALTER TABLE "User" ADD COLUMN "roleId" TEXT;

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
