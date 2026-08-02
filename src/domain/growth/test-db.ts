import type { PrismaClient } from "@prisma/client";

export { createTestPrismaClient, TEST_DATABASE_URL } from "../grid/test-db";

// Deletes children before parents (SoilProfile/Plant reference Bed; run this
// BEFORE resetGridTables in a test file's beforeEach so a subsequent Bed
// delete never leaves an orphaned SoilProfile row lingering into the next
// test, even though this driver adapter doesn't itself enforce the FK — see
// prisma/schema.prisma's datasource comment).
export async function resetGrowthTables(prisma: PrismaClient): Promise<void> {
  await prisma.diseaseInfection.deleteMany();
  await prisma.pestPopulation.deleteMany();
  await prisma.predatorPopulation.deleteMany();
  await prisma.plantingBiologyState.deleteMany();
  await prisma.cellEnvironmentState.deleteMany();
  await prisma.simClockEpoch.deleteMany();
  await prisma.weatherDay.deleteMany();
  await prisma.soilProfile.deleteMany();
  await prisma.speciesProfile.deleteMany();
}
