-- AlterTable
ALTER TABLE "IrrigationSystem" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rainSkipEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rainSkipLookbackDays" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "rainSkipThresholdMm" DOUBLE PRECISION NOT NULL DEFAULT 6;
