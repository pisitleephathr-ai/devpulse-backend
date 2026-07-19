-- Additive, non-destructive: extend TaskAttachment to support Cloudinary signed
-- direct uploads alongside the existing URL attachments, and add UploadIntent to
-- back the signed-upload handshake (replay/duplicate protection + orphan cleanup).
--
-- Existing TaskAttachment rows are preserved untouched: new columns are nullable
-- or defaulted, so every legacy URL attachment stays valid and keeps rendering.
-- `source` backfills to 'URL' and `kind` to 'LINK' for existing rows (correct for
-- pasted-link attachments); Cloudinary uploads set these explicitly.

-- CreateEnum
CREATE TYPE "AttachmentSource" AS ENUM ('URL', 'CLOUDINARY');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'DOCUMENT', 'LINK');

-- AlterTable: add the new attachment columns (all additive)
ALTER TABLE "TaskAttachment"
    ADD COLUMN "source" "AttachmentSource" NOT NULL DEFAULT 'URL',
    ADD COLUMN "kind" "AttachmentKind" NOT NULL DEFAULT 'LINK',
    ADD COLUMN "originalName" TEXT,
    ADD COLUMN "displayName" TEXT,
    ADD COLUMN "mimeType" TEXT,
    ADD COLUMN "extension" TEXT,
    ADD COLUMN "cloudinaryPublicId" TEXT,
    ADD COLUMN "cloudinaryVersion" INTEGER,
    ADD COLUMN "cloudinaryAssetId" TEXT,
    ADD COLUMN "cloudinaryResourceType" TEXT,
    ADD COLUMN "cloudinaryFormat" TEXT,
    ADD COLUMN "secureUrl" TEXT,
    ADD COLUMN "thumbnailUrl" TEXT,
    ADD COLUMN "width" INTEGER,
    ADD COLUMN "height" INTEGER,
    ADD COLUMN "uploadedById" TEXT,
    ADD COLUMN "deleteStatus" TEXT,
    ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex: one attachment per Cloudinary asset (nullable → many legacy NULLs allowed)
CREATE UNIQUE INDEX "TaskAttachment_cloudinaryAssetId_key" ON "TaskAttachment"("cloudinaryAssetId");

-- CreateIndex
CREATE INDEX "TaskAttachment_uploadedById_idx" ON "TaskAttachment"("uploadedById");

-- AddForeignKey
ALTER TABLE "TaskAttachment"
    ADD CONSTRAINT "TaskAttachment_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "UploadIntent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expectedSize" INTEGER NOT NULL,
    "resourceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadIntent_publicId_key" ON "UploadIntent"("publicId");

-- CreateIndex
CREATE INDEX "UploadIntent_taskId_idx" ON "UploadIntent"("taskId");

-- CreateIndex
CREATE INDEX "UploadIntent_userId_idx" ON "UploadIntent"("userId");

-- CreateIndex
CREATE INDEX "UploadIntent_expiresAt_idx" ON "UploadIntent"("expiresAt");

-- AddForeignKey
ALTER TABLE "UploadIntent"
    ADD CONSTRAINT "UploadIntent_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadIntent"
    ADD CONSTRAINT "UploadIntent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
