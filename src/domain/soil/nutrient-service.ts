// Per-cell N/P/K/Ca(+micronutrient) pools — the same "fraction of a nominal
// capacity" convention water-bucket-service.ts uses for soil moisture, not
// lab-accurate mass. See the architecture doc's §4/§7 for the full design.
// Deliberately does NOT track a separate "soil biological activity index"
// scalar: decomposition's biology-dependent rate is folded into
// BASE_DECOMPOSITION_RATE below, a documented Phase 2 scope simplification
// (SPEC-GROWTH-002).
//
// Pure and cheap by design, same contract as stepWaterBucket: every input is
// a plain value, every output is a plain value, no I/O — callable from both
// the real catch-up step and the what-if projection without two divergent
// nutrient models (src/domain/growth/daily-step-orchestrator.ts).

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface NutrientPoolState {
  nitrogenPoolFraction: number;
  phosphorusPoolFraction: number;
  potassiumPoolFraction: number;
  calciumPoolFraction: number;
  micronutrientIndexFraction: number;
  residueOrganicMatterPool: number;
}

// A single species x stage nutrient demand, already scaled by
// species.baseNutrientDemand and the stage-shaped
// NUTRIENT_DEMAND_BY_STAGE table (growth-engine-service.ts) — resolved by
// the caller so this file never needs to import PhenologyStage from the
// growth domain (soil stays a dependency OF growth, not the reverse, same
// direction water-bucket-service.ts already established).
export interface NutrientDemand {
  n: number;
  p: number;
  k: number;
  ca: number;
}

export interface NutrientStepInputs {
  pools: NutrientPoolState;
  soilMoistureFraction: number; // 0 = wilting point, 1 = field capacity — same value stepWaterBucket returns
  soilTempC: number;
  drainageMm: number; // that day's stepWaterBucket drainage output — the leaching driver
  rootFraction: number;
  demand: NutrientDemand;
}

export interface NutrientSatisfaction {
  n: number;
  p: number;
  k: number;
  ca: number;
}

export interface NutrientStepResult {
  pools: NutrientPoolState;
  nutrientSatisfaction: NutrientSatisfaction;
}

// A day's worth of residue converts to available nutrients at this rate,
// modulated by moisture/temperature response curves below — a simplified
// stand-in for what real soil microbes/worms/fungi do (the "structurally
// faithful, not exact" compromise from the architecture doc's §1/§4).
const BASE_DECOMPOSITION_RATE = 0.12;
// Real compost/mulch decomposition releases N/P/K in a rough ratio, not
// evenly — nitrogen-heaviest, phosphorus-lightest (it binds soil particles
// and mineralizes slowest).
const RESIDUE_RELEASE_RATIO = { n: 0.5, p: 0.2, k: 0.3 };
const UPTAKE_RATE_CONSTANT = 0.35;
// A single meaningful drainage event (mm) that would wash out most of the
// most mobile pool in one day — a normalizing constant, not a measured
// value.
const LEACH_NORMALIZING_MM = 30;
// Nitrogen is the most soil-mobile nutrient (leaches fastest); phosphorus
// and potassium bind soil particles and leach far slower — real agronomy,
// and what makes "heavy rain right after fertilizing wastes it" specifically
// a nitrogen lesson (architecture doc §7).
const LEACH_FRACTION_AT_NORMALIZING_DRAINAGE = { n: 0.3, p: 0.03, k: 0.08, ca: 0.02 };
// Exported for care-actions-service.ts, which clamps compost/organic
// fertilizer additions to the same ceiling this file's own decomposition
// step respects — one shared bound, not two independently-tuned limits.
export const RESIDUE_POOL_CEILING = 5;
const MICRONUTRIENT_DRIFT_RATE = 0.02;

// Decomposition peaks at a moderate moisture level (neither dry nor
// waterlogged — real decomposer activity needs both moisture and oxygen)
// and within a warm-but-not-extreme temperature band, mirroring the bell
// curves growth-engine-service.ts already uses for temperature response.
function moistureResponse(soilMoistureFraction: number): number {
  return clamp01(1 - Math.abs(soilMoistureFraction - 0.6) / 0.6);
}
function decompositionTempResponse(soilTempC: number): number {
  return clamp01(1 - Math.abs(soilTempC - 25) / 25);
}

export function stepNutrientPools(inputs: NutrientStepInputs): NutrientStepResult {
  const decompositionRate =
    BASE_DECOMPOSITION_RATE * moistureResponse(inputs.soilMoistureFraction) * decompositionTempResponse(inputs.soilTempC);
  const decomposedAmount = inputs.pools.residueOrganicMatterPool * decompositionRate;
  const residueOrganicMatterPool = Math.max(0, Math.min(RESIDUE_POOL_CEILING, inputs.pools.residueOrganicMatterPool - decomposedAmount));

  const leachRatio = clamp01(Math.max(inputs.drainageMm, 0) / LEACH_NORMALIZING_MM);
  const moistureAvailability = clamp01(inputs.soilMoistureFraction);

  function stepOnePool(
    poolFraction: number,
    demand: number,
    decomposedGain: number,
    leachFractionAtFull: number,
  ): { pool: number; satisfaction: number } {
    // desiredUptake deliberately does NOT scale by moisture — it's what the
    // plant would draw under ideal moisture, so a dry cell's shortfall shows
    // up as unmet demand (satisfaction < 1), not as "there was nothing to
    // want" (satisfaction trivially 1). moistureAvailability instead limits
    // how much of that desire is actually achievable this step — this is
    // the mechanism behind "drought indirectly causes nutrient stress even
    // with adequate soil nutrients" (architecture doc §7).
    const desiredUptake = inputs.rootFraction * UPTAKE_RATE_CONSTANT * Math.max(demand, 0);
    const potentialUptake = desiredUptake * moistureAvailability;
    const actualUptake = Math.min(potentialUptake, poolFraction);
    const satisfaction = desiredUptake > 0 ? clamp01(actualUptake / desiredUptake) : 1;
    const leached = poolFraction * leachFractionAtFull * leachRatio;
    const pool = clamp01(poolFraction - actualUptake - leached + decomposedGain);
    return { pool, satisfaction };
  }

  const nitrogen = stepOnePool(
    inputs.pools.nitrogenPoolFraction,
    inputs.demand.n,
    decomposedAmount * RESIDUE_RELEASE_RATIO.n,
    LEACH_FRACTION_AT_NORMALIZING_DRAINAGE.n,
  );
  const phosphorus = stepOnePool(
    inputs.pools.phosphorusPoolFraction,
    inputs.demand.p,
    decomposedAmount * RESIDUE_RELEASE_RATIO.p,
    LEACH_FRACTION_AT_NORMALIZING_DRAINAGE.p,
  );
  const potassium = stepOnePool(
    inputs.pools.potassiumPoolFraction,
    inputs.demand.k,
    decomposedAmount * RESIDUE_RELEASE_RATIO.k,
    LEACH_FRACTION_AT_NORMALIZING_DRAINAGE.k,
  );
  // Calcium isn't released by residue decomposition in this simplified
  // model (real compost contributes comparatively little Ca versus lime/gypsum
  // amendments, which are out of scope) — only uptake and slow leaching apply.
  const calcium = stepOnePool(inputs.pools.calciumPoolFraction, inputs.demand.ca, 0, LEACH_FRACTION_AT_NORMALIZING_DRAINAGE.ca);

  // No dedicated micronutrient action exists yet (Phase 2 scope) — it
  // passively drifts toward overall soil nutrient health, which is enough
  // to drive the chlorosis visual cue (Plant.tsx) without a whole extra
  // subsystem.
  const avgSatisfaction = (nitrogen.satisfaction + phosphorus.satisfaction + potassium.satisfaction) / 3;
  const micronutrientTarget = 0.3 + 0.5 * avgSatisfaction;
  const micronutrientIndexFraction = clamp01(
    inputs.pools.micronutrientIndexFraction +
      (micronutrientTarget - inputs.pools.micronutrientIndexFraction) * MICRONUTRIENT_DRIFT_RATE,
  );

  return {
    pools: {
      nitrogenPoolFraction: nitrogen.pool,
      phosphorusPoolFraction: phosphorus.pool,
      potassiumPoolFraction: potassium.pool,
      calciumPoolFraction: calcium.pool,
      micronutrientIndexFraction,
      residueOrganicMatterPool,
    },
    nutrientSatisfaction: {
      n: nitrogen.satisfaction,
      p: phosphorus.satisfaction,
      k: potassium.satisfaction,
      ca: calcium.satisfaction,
    },
  };
}
