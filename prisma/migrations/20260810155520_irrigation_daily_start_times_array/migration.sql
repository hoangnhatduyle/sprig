/*
  Warnings:

  - You are about to drop the column `dailyStartTime` on the `IrrigationSystem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "IrrigationSystem" DROP COLUMN "dailyStartTime",
ADD COLUMN     "dailyStartTimes" TEXT[] DEFAULT ARRAY['08:00', '17:00']::TEXT[];
