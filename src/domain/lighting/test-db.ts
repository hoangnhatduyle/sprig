import type { PrismaClient } from "@prisma/client";

export { createTestPrismaClient, TEST_DATABASE_URL } from "../grid/test-db";

export async function resetLightingTables(prisma: PrismaClient): Promise<void> {
  // No FK relationship between these two tables (unlike the grid tables'
  // real cascade order) — safe to clear independently and in parallel.
  await Promise.all([prisma.solarLight.deleteMany(), prisma.gardenLocation.deleteMany()]);
}
