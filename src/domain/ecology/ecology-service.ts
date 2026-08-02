// Resolves companion-planting proximity into per-cell modifiers — cell
// adjacency + the companion-catalog.ts source table, computed once per bed
// per catch-up pass (not once per cell), the same "bed-scoped, computed
// once" shape src/domain/conditions/bed-effective-conditions.ts already
// established for equipment overrides. See the architecture doc's §11.

import { companionEffectsForSpecies, type CompanionEffectKind } from "./companion-catalog";

export interface EcologyCell {
  cellId: string;
  column: number;
  row: number;
  speciesKeys: readonly string[];
}

export interface EcologyModifiers {
  nitrogenTrickle: number;
  pollinatorBoost: number;
  allelopathicPenalty: number;
  // Phase 3 (SPEC-GROWTH-003): feeds pest-service.ts's predator immigration
  // term, bed-averaged by catch-up-service.ts before use (predator
  // populations are bed-scoped, not per-cell, unlike the other three
  // modifiers here).
  predatorAttraction: number;
}

// Exported so callers with no companion neighbors at all (e.g. a bed with
// only one un-catalogued planting) have a ready-made zero value rather than
// constructing their own — daily-step-orchestrator.ts's callers use this as
// the fallback when a cell is missing from a bed's precomputed modifier map.
export const NEUTRAL_MODIFIERS: EcologyModifiers = {
  nitrogenTrickle: 0,
  pollinatorBoost: 0,
  allelopathicPenalty: 0,
  predatorAttraction: 0,
};

// Same cell = full strength (co-planted companions, the existing
// Plant.isCompanionPlanting case); orthogonally adjacent cell (Manhattan
// distance 1, same bed) = half strength — a cheap, explicit distance
// decay rather than a continuous falloff function, per §11's "distance-
// decayed to adjacent/near cells."
function proximityStrength(a: EcologyCell, b: EcologyCell): number {
  if (a.cellId === b.cellId) return 1;
  const distance = Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
  return distance === 1 ? 0.5 : 0;
}

function applyKind(modifiers: EcologyModifiers, kind: CompanionEffectKind, amount: number): EcologyModifiers {
  switch (kind) {
    case "NITROGEN_FIX":
      return { ...modifiers, nitrogenTrickle: modifiers.nitrogenTrickle + amount };
    case "POLLINATOR_BOOST":
      return { ...modifiers, pollinatorBoost: modifiers.pollinatorBoost + amount };
    case "ALLELOPATHIC":
      return { ...modifiers, allelopathicPenalty: modifiers.allelopathicPenalty + amount };
    case "PREDATOR_ATTRACT":
      return { ...modifiers, predatorAttraction: modifiers.predatorAttraction + amount };
  }
}

export function computeEcologyModifiersForBed(cells: readonly EcologyCell[]): Map<string, EcologyModifiers> {
  const modifiers = new Map<string, EcologyModifiers>();

  for (const target of cells) {
    let accumulated = NEUTRAL_MODIFIERS;
    for (const nearby of cells) {
      const strength = proximityStrength(target, nearby);
      if (strength === 0) continue;
      for (const speciesKey of nearby.speciesKeys) {
        for (const source of companionEffectsForSpecies(speciesKey)) {
          if (source.targetSpeciesKey && !target.speciesKeys.includes(source.targetSpeciesKey)) {
            continue;
          }
          accumulated = applyKind(accumulated, source.kind, source.magnitude * strength);
        }
      }
    }
    modifiers.set(target.cellId, accumulated);
  }

  return modifiers;
}
