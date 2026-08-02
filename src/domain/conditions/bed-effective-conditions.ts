import type { ConditionOverrideKind, PrismaClient } from "@prisma/client";
import { combineModifiers, NEUTRAL_MODIFIERS, type ConditionModifiers } from "./condition-modifiers";

// How each equipment kind translates into the shared modifier vocabulary.
// Adding a new equipment kind is a config change here, not a change to the
// growth engine or the water bucket — both only ever see the resulting
// ConditionModifiers.
const KIND_TO_MODIFIER: Record<ConditionOverrideKind, (intensity: number) => ConditionModifiers> = {
  SHADE_CLOTH: (intensity) => ({ lightMultiplier: 1 - intensity, rainMultiplier: 1 }),
  GROW_LIGHT: (intensity) => ({ lightMultiplier: 1 + intensity, rainMultiplier: 1 }),
  RAIN_COVER: (intensity) => ({ lightMultiplier: 1, rainMultiplier: 1 - intensity }),
};

// Combines every currently-installed override on a bed into one net
// ConditionModifiers — multiple different kinds stack (a shade cloth AND a
// rain cover together), each contributing its own factor. Called once per
// planting per catch-up (not once per simulated day) since installed
// equipment is read as "currently active", not tracked date-by-date across
// the catch-up window — the same simplification WeatherSource switching
// already makes (see the architecture doc's §3/§19).
export async function getBedEffectiveConditions(
  prisma: PrismaClient,
  bedId: string,
): Promise<ConditionModifiers> {
  const overrides = await prisma.bedConditionOverride.findMany({ where: { bedId, removedAt: null } });
  return overrides.reduce((combined, override) => {
    const toModifier = KIND_TO_MODIFIER[override.kind];
    return combineModifiers(combined, toModifier(override.intensity));
  }, NEUTRAL_MODIFIERS);
}
