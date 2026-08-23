import type { PrismaClient } from "@prisma/client";

export { createTestPrismaClient, TEST_DATABASE_URL } from "../grid/test-db";

export async function resetIrrigationTables(prisma: PrismaClient): Promise<void> {
  await prisma.rainBarrelEvent.deleteMany();
  await prisma.rainBarrel.deleteMany();
  await prisma.irrigationRun.deleteMany();
  await prisma.irrigationSystem.deleteMany();
  // Rain-skip (SPEC-IRRIGATION-001 v0.2.0) reads WeatherDay rows — cleared
  // here too so a rainfall row seeded by one test can't leak into the next.
  await prisma.weatherDay.deleteMany();
}
