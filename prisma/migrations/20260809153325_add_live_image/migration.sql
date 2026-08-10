-- CreateTable
CREATE TABLE "LiveImage" (
    "id" TEXT NOT NULL,
    "photoFilename" TEXT NOT NULL,
    "photoMimeType" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveImage_capturedAt_idx" ON "LiveImage"("capturedAt");
