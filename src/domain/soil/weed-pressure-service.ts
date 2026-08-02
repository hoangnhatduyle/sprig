// Per-cell weed-pressure scalar (architecture doc §12's "reduces a 'weed
// pressure' scalar" human action, roadmap Phase 3). Deliberately the
// lightest-weight subsystem in this phase: weeds compete for light/water/
// nutrients with the planted crop, but rather than modeling a second
// simulated organism, weedPressureFraction is a single 0..1 dial that
// multiplies directly into growth-engine-service.ts's growthPenalty — the
// same treatment allelopathicPenalty already gets there, not a Liebig
// stress dial of its own. Pure and cheap, same no-I/O contract as the rest
// of the soil domain.

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// A moderate warm-moist condition favors weed germination/growth, mirroring
// the same bell-curve shape nutrient-service.ts's decomposition response
// already uses — not a real weed-ecology model, just "not too dry, not too
// cold" being the intuitively-correct direction.
function weedConditionFactor(soilMoistureFraction: number, soilTempC: number): number {
  const moistureFactor = clamp01(1 - Math.abs(soilMoistureFraction - 0.55) / 0.55);
  const tempFactor = clamp01(1 - Math.abs(soilTempC - 20) / 20);
  return moistureFactor * tempFactor;
}

// Bare soil at full growth rate reaches near-total weed pressure in a
// few simulated weeks — a normalizing constant tuned for "visibly matters
// within a season," not measured field data.
const BASE_WEED_GROWTH_RATE = 0.04;

export interface WeedPressureStepInputs {
  weedPressureFraction: number;
  // 1 = no mulch, lower = more suppression — the exact same convention
  // water-bucket-service.ts's mulchFactorFromDepth already produces, reused
  // here rather than a second mulch-effect curve (architecture doc §4:
  // mulch "suppresses weed pressure" is one more multiplier on an existing
  // formula, not new machinery).
  mulchFactor: number;
  soilMoistureFraction: number;
  soilTempC: number;
}

export function stepWeedPressure(inputs: WeedPressureStepInputs): number {
  const conditionFactor = weedConditionFactor(inputs.soilMoistureFraction, inputs.soilTempC);
  const growth =
    BASE_WEED_GROWTH_RATE * inputs.mulchFactor * conditionFactor * (1 - inputs.weedPressureFraction);
  return clamp01(inputs.weedPressureFraction + growth);
}

// How much of growthPenalty is lost per unit of weed pressure at its
// maximum (weedPressureFraction = 1) — competition for light/water/
// nutrients, not a resource-scarcity dial of its own, so it multiplies
// growthPenalty directly rather than joining stress-service.ts's Liebig
// combination (the same treatment EcologyModifiers.allelopathicPenalty
// already gets in growth-engine-service.ts).
export const WEED_COMPETITION_MAX_PENALTY = 0.3;

export function weedCompetitionPenalty(weedPressureFraction: number): number {
  return clamp01(weedPressureFraction) * WEED_COMPETITION_MAX_PENALTY;
}
