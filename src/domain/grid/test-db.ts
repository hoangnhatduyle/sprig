import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Local Docker Postgres (see docker-compose.yml), isolated from the "public"
// dev schema via its own Postgres schema so `pnpm test` never touches dev
// data. Override via TEST_DATABASE_URL for CI.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://sprig:sprig@localhost:5432/sprig?schema=test";

export function createTestPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: TEST_DATABASE_URL });
  return new PrismaClient({ adapter });
}

export async function resetGridTables(prisma: PrismaClient): Promise<void> {
  await prisma.harvestRecord.deleteMany();
  await prisma.gridCellEvent.deleteMany();
  await prisma.careActionEvent.deleteMany();
  await prisma.journalNote.deleteMany();
  await prisma.cellPlanting.deleteMany();
  await prisma.bedRenovation.deleteMany();
  await prisma.gridCell.deleteMany();
  await prisma.plant.deleteMany();
  await prisma.bed.deleteMany();
}
