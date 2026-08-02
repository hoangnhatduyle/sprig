import type { PrismaClient } from "@prisma/client";

export { createTestPrismaClient, TEST_DATABASE_URL } from "../grid/test-db";

export async function resetSeasonTables(prisma: PrismaClient): Promise<void> {
  await prisma.seasonBoundary.deleteMany();
}
