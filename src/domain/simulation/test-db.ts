import type { PrismaClient } from "@prisma/client";

export { createTestPrismaClient, TEST_DATABASE_URL } from "../grid/test-db";

export async function resetSimulationTables(prisma: PrismaClient): Promise<void> {
  await prisma.simulationRun.deleteMany();
}
