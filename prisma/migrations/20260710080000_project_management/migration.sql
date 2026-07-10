-- AlterTable: additive project-management fields (existing rows keep defaults)
ALTER TABLE "Project" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Project" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Project_isArchived_idx" ON "Project"("isArchived");
