// Bed-scoped pest and predator population dynamics (architecture doc §10):
// logistic growth capped by host-biomass-scaled carrying capacity, coupled
// to predator populations via a Lotka-Volterra pair, plus the per-planting
// damage those populations inflict. Pure and cheap, no I/O — catch-up-service.ts
// owns persistence (PestPopulation/PredatorPopulation rows) and the "resolve
// once per bed per catch-up call" cadence documented there.
//
// Population values are plain nonnegative scalars (not 0..1 fractions) —
// "how many population-units this bed currently supports," scaled by
// carryingCapacityPerHostBiomass, not a lab count. Doesn't need to be: only
// relative magnitude and the emergent boom-bust shape matter for a
// monitoring tool (architecture doc §1/§10).

import type { GrowthHabit } from "@prisma/client";
import { isActiveSeason, pestsForGrowthHabit, type PestDefinition } from "./pest-catalog";
import { predatorsForPest, type PredatorDefinition } from "./predator-catalog";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Out-of-season decay toward the overwintering floor moves at this fraction
// of the remaining gap per day — a normalizing constant, not a measured
// insect-biology value (same "cheap normalizing constant" spirit as
// stress-service.ts's own STRESS_NORMALIZING_RANGE_C).
const OUT_OF_SEASON_DECAY_RATE = 0.05;
const MIN_CARRYING_CAPACITY = 0.5;

export interface PestPopulationState {
  [pestKey: string]: number;
}
export interface PredatorPopulationState {
  [predatorKey: string]: number;
}

export interface PestStepInputs {
  populations: PestPopulationState;
  predatorPopulations: PredatorPopulationState;
  hostBiomass: number; // total leaf+stem biomass fraction summed across the bed's plantings
  monthIndex1to12: number;
}

// One simulated day of logistic growth (food-capped by host biomass),
// seasonal decay toward the overwintering floor, and Lotka-Volterra
// predation loss — the architecture doc's own
// "plant biomass -> pest population -> predator population -> plant damage"
// food chain, fully emergent from these three coupled steps.
export function stepPestPopulations(pests: readonly PestDefinition[], inputs: PestStepInputs): PestPopulationState {
  const next: PestPopulationState = {};
  for (const pest of pests) {
    const current = inputs.populations[pest.key] ?? 0;
    if (!isActiveSeason(pest, inputs.monthIndex1to12)) {
      next[pest.key] = Math.max(0, current + (pest.overwinteringFloor - current) * OUT_OF_SEASON_DECAY_RATE);
      continue;
    }
    const carryingCapacity = Math.max(MIN_CARRYING_CAPACITY, pest.carryingCapacityPerHostBiomass * inputs.hostBiomass);
    const logisticGrowth = pest.intrinsicGrowthRate * current * (1 - current / carryingCapacity);
    const predationLoss = predatorsForPest(pest.key).reduce((sum, predator) => {
      const predatorPopulation = inputs.predatorPopulations[predator.key] ?? 0;
      return sum + predator.preyDeathRate * predatorPopulation * current;
    }, 0);
    next[pest.key] = Math.max(0, current + logisticGrowth - predationLoss);
  }
  return next;
}

export interface PredatorStepInputs {
  predatorPopulations: PredatorPopulationState;
  pestPopulations: PestPopulationState;
  // 0..1, ecology-service.ts's bed-averaged PREDATOR_ATTRACT modifier —
  // nearby insectary companions (marigold, dill) boosting immigration.
  insectaryAttraction: number;
}

export function stepPredatorPopulations(
  predators: readonly PredatorDefinition[],
  inputs: PredatorStepInputs,
): PredatorPopulationState {
  const next: PredatorPopulationState = {};
  for (const predator of predators) {
    const current = inputs.predatorPopulations[predator.key] ?? 0;
    const preyPopulation = predator.preyPestKeys.reduce((sum, key) => sum + (inputs.pestPopulations[key] ?? 0), 0);
    const growth = predator.predationGrowthRate * preyPopulation * current;
    const decay = predator.baseDeathRate * current;
    const immigration = predator.baseImmigrationRate * (1 + inputs.insectaryAttraction * predator.insectaryBoostMultiplier);
    next[predator.key] = Math.max(0, current + growth - decay + immigration);
  }
  return next;
}

export interface PestDamageEffect {
  energyPenalty: number;
  leafLossFraction: number;
}

export const NEUTRAL_PEST_DAMAGE: PestDamageEffect = { energyPenalty: 0, leafLossFraction: 0 };

// Aggregates every pest applicable to this planting's growth habit into one
// damage effect for the day, using the bed's current (snapshotted)
// population levels — aphids sap energy, caterpillars/slugs eat leaf
// directly, slugs specifically hit seedlings harder.
export function computeDamageForPlanting(
  growthHabit: GrowthHabit,
  populations: PestPopulationState,
  isSeedlingStage: boolean,
): PestDamageEffect {
  let energyPenalty = 0;
  let leafLossFraction = 0;
  for (const pest of pestsForGrowthHabit(growthHabit)) {
    const population = populations[pest.key] ?? 0;
    if (population <= 0) continue;
    energyPenalty += population * pest.damage.energyPenaltyPerUnitPopulation;
    const seedlingMultiplier = isSeedlingStage ? pest.damage.seedlingDamageMultiplier : 1;
    leafLossFraction += population * pest.damage.leafLossFractionPerUnitPopulation * seedlingMultiplier;
  }
  return { energyPenalty: clamp01(energyPenalty), leafLossFraction: clamp01(leafLossFraction) };
}

// Rolls every applicable pest/damage effect into the single 0..1
// "pestDisease" stress-dial value stress-service.ts combines via Liebig's
// Law — the general-vigor signal, on top of the specific
// energy/leaf-loss channels above.
const PRESSURE_DIAL_NORMALIZING_POPULATION = 6;

export function pestPressureDialValue(growthHabit: GrowthHabit, populations: PestPopulationState): number {
  let totalPopulation = 0;
  for (const pest of pestsForGrowthHabit(growthHabit)) {
    totalPopulation += populations[pest.key] ?? 0;
  }
  return clamp01(totalPopulation / PRESSURE_DIAL_NORMALIZING_POPULATION);
}
