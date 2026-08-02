import type { PrismaClient } from "@prisma/client";

export { createTestPrismaClient, TEST_DATABASE_URL } from "../grid/test-db";

export async function resetIrrigationTables(prisma: PrismaClient): Promise<void> {
  await prisma.rainBarrelEvent.deleteMany();
  await prisma.rainBarrel.deleteMany();
  await prisma.irrigationRun.deleteMany();
  await prisma.irrigationSystem.deleteMany();
}
