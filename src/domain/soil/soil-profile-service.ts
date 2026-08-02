import type { PrismaClient, SoilProfile } from "@prisma/client";
import { deriveSoilConstants } from "./water-bucket-service";

// A middling loam — a reasonable raised-bed-mix default until a bed's real
// texture is entered.
const DEFAULT_TEXTURE = { sandPct: 40, siltPct: 40, clayPct: 20 };

// Idempotent, self-healing (mirrors src/domain/growth/species-catalog.ts's
// getFallbackSpeciesProfile): the water-bucket step always needs a
// SoilProfile to read, so one is created with sane defaults the first time
// a bed is touched by growth catch-up rather than requiring an explicit
// setup step first.
export async function getOrCreateSoilProfile(prisma: PrismaClient, bedId: string): Promise<SoilProfile> {
  const existing = await prisma.soilProfile.findUnique({ where: { bedId } });
  if (existing) {
    return existing;
  }
  const { fieldCapacityFraction, wiltingPointFraction } = deriveSoilConstants(
    DEFAULT_TEXTURE.sandPct,
    DEFAULT_TEXTURE.siltPct,
    DEFAULT_TEXTURE.clayPct,
  );
  return prisma.soilProfile.create({
    data: { bedId, ...DEFAULT_TEXTURE, fieldCapacityFraction, wiltingPointFraction },
  });
}
