// The full 8-dial stress system (architecture doc §8): heat/cold/drought
// shipped in Phase 1 (inline in growth-engine-service.ts, whose own comment
// there flagged "split into stress-service.ts once it grows" — this file is
// that split), joined here by overwatering, shade, nutrient, transplant
// shock, and wind for Phase 2 (SPEC-GROWTH-002). Pure and cheap, same
// no-I/O contract as the rest of the engine.

import type { DailyWeather } from "@/domain/weather/weather-provider";

export interface StressSpeciesParams {
  heatStressThresholdC: number;
  coldStressThresholdC: number;
  droughtComfortFraction: number;
  lightNeedFraction: number;
  windLodgingThresholdKph: number;
}

export interface NutrientSatisfaction {
  n: number;
  p: number;
  k: number;
  ca: number;
}

export interface StressDials {
  heat: number;
  cold: number;
  drought: number;
  overwater: number;
  shade: number;
  nutrient: number;
  transplantShock: number;
  wind: number;
  // Phase 3 (SPEC-GROWTH-003): max(active disease severity, pest pressure)
  // for this planting — unifying disease/pest into the same Liebig
  // combination as the other 8 dials (architecture doc §8's own dial
  // table). Disease- and pest-specific effects that DON'T fit a
  // resource-scarcity shape (direct biomass loss, light-blocking mildew,
  // aphid energy sap) are applied separately in growth-engine-service.ts,
  // not folded into this dial.
  pestDisease: number;
}

export type BaselineLightLevel = "FULL_SUN" | "PARTIAL_SHADE";

export interface StressInputs {
  weather: DailyWeather;
  soilMoistureFraction: number;
  daysNearSaturation: number;
  baselineLight: BaselineLightLevel;
  nutrientSatisfaction: NutrientSatisfaction;
  plantingAgeDays: number;
  species: StressSpeciesParams;
  // 0..1, precomputed by the caller (daily-step-orchestrator.ts) from the
  // active DiseaseInfection's severity and the bed's pest population
  // pressure (src/domain/pests/pest-service.ts's pestPressureDialValue) —
  // this file stays a dependency OF the disease/pest domains, never the
  // reverse, matching the direction water-bucket-service.ts already
  // established for soil.
  pestDiseaseSeverity: number;
}

// How far beyond a species' comfortable range/threshold counts as "fully
// maxed out" stress for that dial — a normalizing constant, not a
// physiological one. Kept local to this file (a small deliberate
// duplication of growth-engine-service.ts's own STRESS_NORMALIZING_RANGE_C,
// which serves a different function there — photosynthesis efficiency, not
// a stress dial) so the two files don't need to share a constant across a
// module boundary for one number.
const STRESS_NORMALIZING_RANGE_C = 12;
const WIND_NORMALIZING_RANGE_KPH = 30;

// A day counts as "near saturation" above this soil-moisture fraction —
// deliberately below the water bucket's own saturation ceiling (1.15x field
// capacity) so the counter starts accumulating before a cell is fully
// waterlogged, matching real root-oxygen stress onset.
const SATURATION_THRESHOLD_FRACTION = 0.92;
// A couple of well-watered days shouldn't read as "sitting in a swamp" —
// the grace period is what distinguishes "just watered" from sustained
// waterlogging (architecture doc §8).
const OVERWATER_GRACE_DAYS = 2;
const OVERWATER_DECAY_RANGE_DAYS = 5;

// Exponential decay to near-zero by ~10 sim-days — the architecture doc's
// "~5-10 days" window for transplant shock (§8).
const TRANSPLANT_SHOCK_DECAY_CONSTANT_DAYS = 3;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Advances the "days near saturation" streak counter: +1 on a saturated
// day, -1 (floored at 0) on a day that isn't — a duration signal, not an
// instantaneous reading. Called once per simulated day by the growth
// orchestrator, ahead of computeStressDials, since the OVERWATER dial reads
// the already-stepped value for that same day.
export function stepDaysNearSaturation(currentDays: number, soilMoistureFraction: number): number {
  if (soilMoistureFraction >= SATURATION_THRESHOLD_FRACTION) {
    return currentDays + 1;
  }
  return Math.max(0, currentDays - 1);
}

// Extracted so disease-service.ts's root-rot favorable-condition check
// (architecture doc §9: "sustained overwatering stress + poor drainage")
// can reuse the exact same duration-based signal this dial already uses,
// rather than re-deriving it from daysNearSaturation independently.
export function overwaterDialFromDaysNearSaturation(daysNearSaturation: number): number {
  return clamp01((daysNearSaturation - OVERWATER_GRACE_DAYS) / OVERWATER_DECAY_RANGE_DAYS);
}

export function computeStressDials(inputs: StressInputs): StressDials {
  const { weather, species } = inputs;

  const heat = clamp01((weather.tempHighC - species.heatStressThresholdC) / STRESS_NORMALIZING_RANGE_C);
  const cold = clamp01((species.coldStressThresholdC - weather.tempLowC) / STRESS_NORMALIZING_RANGE_C);
  const drought = clamp01(1 - inputs.soilMoistureFraction / species.droughtComfortFraction);

  const overwater = overwaterDialFromDaysNearSaturation(inputs.daysNearSaturation);

  const incidentLightFraction = inputs.baselineLight === "FULL_SUN" ? 1 : 0.5;
  const shade = clamp01(1 - incidentLightFraction / species.lightNeedFraction);

  const { n, p, k, ca } = inputs.nutrientSatisfaction;
  const nutrient = clamp01(Math.max(1 - n, 1 - p, 1 - k, 1 - ca));

  const transplantShock = clamp01(Math.exp(-inputs.plantingAgeDays / TRANSPLANT_SHOCK_DECAY_CONSTANT_DAYS));

  const wind = clamp01((weather.windSpeedKph - species.windLodgingThresholdKph) / WIND_NORMALIZING_RANGE_KPH);

  const pestDisease = clamp01(inputs.pestDiseaseSeverity);

  return { heat, cold, drought, overwater, shade, nutrient, transplantShock, wind, pestDisease };
}

// Liebig's Law of the Minimum: growth is limited by the SCARCEST resource
// across all 8 dials, not an average or product — both the scientifically
// standard model and the better game-design choice (a legible "your main
// problem right now is X" signal). See the architecture doc's §8/§15.
export function combineStress(dials: StressDials): number {
  return Math.max(
    dials.heat,
    dials.cold,
    dials.drought,
    dials.overwater,
    dials.shade,
    dials.nutrient,
    dials.transplantShock,
    dials.wind,
    dials.pestDisease,
  );
}

// Below this, no single dial is really "the problem" worth naming in the
// UI — a mildly elevated dial shouldn't flip a label on and off every other
// day. Matches CellPicker's own existing 0.6 "under sustained stress"
// threshold in spirit (a lower bar here since this labels a single day's
// dominant dial, not the slower-moving cumulativeStress average).
const DOMINANT_STRESS_DISPLAY_THRESHOLD = 0.4;

// PlantingBiologyState.dominantStressDial's source of truth — the read
// model (grid-cell-service.ts) never re-derives this from weather, it just
// surfaces whatever the last daily step persisted here.
export function dominantStressLabel(dials: StressDials): keyof StressDials | null {
  const entries = Object.entries(dials) as Array<[keyof StressDials, number]>;
  const [label, value] = entries.reduce((max, entry) => (entry[1] > max[1] ? entry : max));
  return value >= DOMINANT_STRESS_DISPLAY_THRESHOLD ? label : null;
}
