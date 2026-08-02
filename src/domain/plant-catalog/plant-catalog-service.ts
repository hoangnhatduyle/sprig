import type { Plant, PrismaClient } from "@prisma/client";

// The Plant table doubles as the catalog (see prisma/schema.prisma). PLANTUI
// only consumes it — SPEC-PLANTUI-001 out_of_scope explicitly excludes the
// catalog's own data-entry/management UI (assumed to exist or be seeded
// elsewhere).
export function listPlants(prisma: PrismaClient): Promise<Plant[]> {
  return prisma.plant.findMany({ orderBy: { commonName: "asc" } });
}
