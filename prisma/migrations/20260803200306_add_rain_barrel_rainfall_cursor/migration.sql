-- AlterTable
-- Catch-up cursor for the daily "fill from real rain" step (mirrors
-- PlantingBiologyState/CellEnvironmentState's own updatedThroughDate) — NULL
-- until the first catch-up pass ever runs for a barrel.
ALTER TABLE "RainBarrel" ADD COLUMN     "rainfallAppliedThroughDate" TIMESTAMP(3);
