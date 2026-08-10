import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Local Docker Postgres (see docker-compose.yml), isolated from the "public"
// dev schema via its own Postgres schema so `pnpm test` never touches dev
// data. Override via TEST_DATABASE_URL for CI.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://sprig:sprig@localhost:5432/sprig?schema=test";

// The `?schema=` query param above is a Prisma-URL convention that only
// Prisma's own query engine parses. @prisma/adapter-pg hands the connection
// string straight to node-postgres, which has no idea what `schema=` means
// and silently ignores it, leaving every query on the connection's default
// search_path ("public") — so without this, every test in the suite was
// actually reading and deleting rows in the real dev schema instead of the
// "test" schema its name and every reset function's comments claim. The
// schema has to be passed via PrismaPg's own `options.schema` (its
// documented, adapter-level mechanism for this) to actually take effect.
const TEST_SCHEMA = new URL(TEST_DATABASE_URL).searchParams.get("schema") ?? "public";

export function createTestPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: TEST_DATABASE_URL }, { schema: TEST_SCHEMA });
  return new PrismaClient({ adapter });
}

export async function resetGridTables(prisma: PrismaClient): Promise<void> {
  await prisma.harvestRecord.deleteMany();
  await prisma.gridCellEvent.deleteMany();
  await prisma.careActionEvent.deleteMany();
  await prisma.journalNote.deleteMany();
  await prisma.liveImage.deleteMany();
  await prisma.cellPlanting.deleteMany();
  await prisma.bedRenovation.deleteMany();
  await prisma.gridCell.deleteMany();
  await prisma.plant.deleteMany();
  await prisma.bed.deleteMany();
}
