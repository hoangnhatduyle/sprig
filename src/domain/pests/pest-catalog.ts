// Curated pest config (architecture doc §10) — same "config, not code that
// changes per pest" philosophy as species-catalog.ts/disease-catalog.ts.
// Pests are targeted by GrowthHabit (species-catalog.ts's own archetype
// axis), not by individual speciesKey: real pest preference tracks plant
// form/leafiness more than exact species ("caterpillars eat leaf biomass,
// slugs prefer seedlings/leafy greens"), and reusing GrowthHabit means a
// brand-new free-typed species is automatically covered via its guessed
// archetype, the same "never hard-fails for an unrecognized species"
// guarantee species-catalog.ts's own fallback already provides.

import type { GrowthHabit } from "@prisma/client";

export type PestDamageKind = "SAP_ENERGY" | "EAT_LEAF";

export interface PestDamageProfile {
  kind: PestDamageKind;
  energyPenaltyPerUnitPopulation: number;
  leafLossFractionPerUnitPopulation: number;
  // Extra multiplier on leaf-loss damage while the planting is still a
  // seedling (GERMINATING/VEGETATIVE) — real slug/seedling vulnerability
  // (architecture doc §10's own example), not a blanket bonus.
  seedlingDamageMultiplier: number;
}

export interface PestDefinition {
  key: string;
  displayName: string;
  hostGrowthHabits: readonly GrowthHabit[];
  intrinsicGrowthRate: number;
  carryingCapacityPerHostBiomass: number;
  activeSeasonMonths: readonly number[]; // 1-12; empty = active year-round
  overwinteringFloor: number;
  damage: PestDamageProfile;
}

const ALL_GROWTH_HABITS: readonly GrowthHabit[] = ["UPRIGHT_BUSH", "VINING", "ROSETTE_LEAFY", "ROOT_CROP"];

// Aphids: sap energy income directly rather than eating biomass — the
// architecture doc's own worked "food chain" example, and ladybugs'
// (predator-catalog.ts) primary prey.
const aphid: PestDefinition = {
  key: "aphid",
  displayName: "Aphid",
  hostGrowthHabits: ALL_GROWTH_HABITS,
  intrinsicGrowthRate: 0.18,
  carryingCapacityPerHostBiomass: 8,
  activeSeasonMonths: [4, 5, 6, 7, 8, 9, 10],
  overwinteringFloor: 0.2,
  damage: { kind: "SAP_ENERGY", energyPenaltyPerUnitPopulation: 0.02, leafLossFractionPerUnitPopulation: 0, seedlingDamageMultiplier: 1 },
};

// Caterpillars: direct leaf biomass loss, broad host range.
const caterpillar: PestDefinition = {
  key: "caterpillar",
  displayName: "Caterpillar",
  hostGrowthHabits: ALL_GROWTH_HABITS,
  intrinsicGrowthRate: 0.14,
  carryingCapacityPerHostBiomass: 5,
  activeSeasonMonths: [5, 6, 7, 8, 9],
  overwinteringFloor: 0.1,
  damage: { kind: "EAT_LEAF", energyPenaltyPerUnitPopulation: 0, leafLossFractionPerUnitPopulation: 0.015, seedlingDamageMultiplier: 1.3 },
};

// Slugs: leafy/rosette species and seedlings specifically — the
// architecture doc's own "slugs prefer seedlings/leafy greens" example.
const slug: PestDefinition = {
  key: "slug",
  displayName: "Slug",
  hostGrowthHabits: ["ROSETTE_LEAFY", "UPRIGHT_BUSH"],
  intrinsicGrowthRate: 0.12,
  carryingCapacityPerHostBiomass: 4,
  activeSeasonMonths: [4, 5, 6, 9, 10, 11],
  overwinteringFloor: 0.15,
  damage: { kind: "EAT_LEAF", energyPenaltyPerUnitPopulation: 0, leafLossFractionPerUnitPopulation: 0.02, seedlingDamageMultiplier: 2 },
};

export const PEST_DEFINITIONS: readonly PestDefinition[] = [aphid, caterpillar, slug];

const PEST_BY_KEY = new Map(PEST_DEFINITIONS.map((pest) => [pest.key, pest]));

export function getPestDefinition(key: string): PestDefinition | undefined {
  return PEST_BY_KEY.get(key);
}

export function pestsForGrowthHabit(growthHabit: GrowthHabit): readonly PestDefinition[] {
  return PEST_DEFINITIONS.filter((pest) => pest.hostGrowthHabits.includes(growthHabit));
}

// Outside its active-season window, a pest population decays toward this
// small floor rather than true zero (abstracted overwintering) so it can
// plausibly return next season instead of needing to reinfest from nothing
// (architecture doc §10).
export function isActiveSeason(pest: PestDefinition, monthIndex1to12: number): boolean {
  return pest.activeSeasonMonths.length === 0 || pest.activeSeasonMonths.includes(monthIndex1to12);
}
