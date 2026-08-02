import type { BedConditionOverride, ConditionOverrideKind, PrismaClient } from "@prisma/client";
import { InvalidConditionIntensityError } from "./errors";

// Real, persistent equipment bounds — deliberately conservative so this
// mode can't become a realism-breaking cheat code (architecture doc's
// §15/§19): a shade cloth doesn't remove all light, a grow light doesn't
// simulate a sun, a rain cover doesn't summon rain. The what-if preview
// (whatif-projection-service.ts) is explicitly NOT bound by these — nothing
// there is committed, so wider exploratory ranges are safe there.
export const INTENSITY_BOUNDS: Record<ConditionOverrideKind, [number, number]> = {
  SHADE_CLOTH: [0, 0.8],
  GROW_LIGHT: [0, 0.6],
  RAIN_COVER: [0, 0.9],
};

function assertValidIntensity(kind: ConditionOverrideKind, intensity: number): void {
  const [min, max] = INTENSITY_BOUNDS[kind];
  if (!Number.isFinite(intensity) || intensity < min || intensity > max) {
    throw new InvalidConditionIntensityError(
      `${kind} intensity ${intensity} must be a finite number between ${min} and ${max}.`,
    );
  }
}

export interface InstallConditionOverrideInput {
  bedId: string;
  kind: ConditionOverrideKind;
  intensity: number;
}

// Installs a new override rather than updating an existing one of the same
// kind in place — installedAt/removedAt is an append-only pattern (mirrors
// CellPlanting), so a bed's equipment history stays reconstructable. Any
// currently-active override of the SAME kind on this bed is retired first:
// re-stacking the same kind would double-apply its modifier for no
// realistic reason, unlike stacking DIFFERENT kinds together (a bed can
// have a shade cloth AND a rain cover at once).
export async function installConditionOverride(
  prisma: PrismaClient,
  input: InstallConditionOverrideInput,
): Promise<BedConditionOverride> {
  assertValidIntensity(input.kind, input.intensity);
  return prisma.$transaction(async (tx) => {
    await tx.bed.findUniqueOrThrow({ where: { id: input.bedId } });
    await tx.bedConditionOverride.updateMany({
      where: { bedId: input.bedId, kind: input.kind, removedAt: null },
      data: { removedAt: new Date() },
    });
    return tx.bedConditionOverride.create({
      data: { bedId: input.bedId, kind: input.kind, intensity: input.intensity },
    });
  });
}

export async function removeConditionOverride(prisma: PrismaClient, overrideId: string): Promise<void> {
  await prisma.bedConditionOverride.update({
    where: { id: overrideId },
    data: { removedAt: new Date() },
  });
}

export function listActiveConditionOverrides(
  prisma: PrismaClient,
  bedId: string,
): Promise<BedConditionOverride[]> {
  return prisma.bedConditionOverride.findMany({
    where: { bedId, removedAt: null },
    orderBy: { installedAt: "asc" },
  });
}
