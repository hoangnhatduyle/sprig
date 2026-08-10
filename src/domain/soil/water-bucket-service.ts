// A single-bucket soil-moisture model per cell — the same simplification
// real irrigation-scheduling software uses (FAO-56 style), not a multi-layer
// or capillary-rise model. See the architecture doc's §5 for the full
// design and why this level of detail is the right tradeoff for a raised
// garden bed.

import { InvalidSoilTextureError } from "./errors";

// The effective root-zone depth this fraction-based bucket represents — a
// raised-bed-scale approximation, not a real soil-layer model.
const ROOT_ZONE_DEPTH_MM = 150;

export function deriveSoilConstants(
  sandPct: number,
  siltPct: number,
  clayPct: number,
): { fieldCapacityFraction: number; wiltingPointFraction: number } {
  if (Math.abs(sandPct + siltPct + clayPct - 100) > 0.5) {
    throw new InvalidSoilTextureError(
      `Soil texture percentages (${sandPct}/${siltPct}/${clayPct}) must sum to 100.`,
    );
  }
  const clayFraction = clayPct / 100;
  const siltFraction = siltPct / 100;
  // A simplified linear approximation of the USDA texture-triangle
  // relationship (real pedotransfer functions are considerably more
  // involved): clay and silt both raise water-holding capacity, sand lowers
  // it. Good enough to differentiate "sandy" from "clay-heavy" beds without
  // modeling real soil physics.
  const fieldCapacityFraction = 0.2 + clayFraction * 0.35 + siltFraction * 0.1;
  const wiltingPointFraction = 0.05 + clayFraction * 0.22 + siltFraction * 0.04;
  return { fieldCapacityFraction, wiltingPointFraction };
}

// Extracted from the daily-step orchestrator's inline formula so the same
// reference-ET estimate can be recomputed for display (a per-cell soil card)
// without persisting a new column — see estimateEvapotranspirationDisplayMm.
export function estimateReferenceEt0Mm(meanTempC: number): number {
  return Math.max(0, meanTempC - 5) * 0.15;
}

// A typical garden drip/soaker grid (e.g. a raised-bed drip irrigation kit)
// delivers on the rough order of half a millimeter of water per minute of
// runtime across the bed it covers — a tunable estimate, not a measured
// flow rate for any specific hardware. Adjust once real plant response to
// the actual installed system is observed; a 10-minute cycle at this rate
// delivers 6mm, comparable to a modest rain event.
export const DRIP_DELIVERY_MM_PER_MINUTE = 0.6;

// One IrrigationRun's water delivery, in the same mm units the water bucket
// already uses for rain — durationMinutes comes from the IrrigationSystem
// that produced the run, not the run's own (possibly still-open) actual
// elapsed time, so a cycle counts its full nominal delivery once it's
// recorded regardless of exactly when it's read.
export function irrigationDeliveryMm(durationMinutes: number): number {
  return Math.max(0, durationMinutes) * DRIP_DELIVERY_MM_PER_MINUTE;
}

// Display-only recompute of "how much water is this cell losing today,"
// mirroring stepWaterBucket's etDemandMm = et0 * cropCoefficient * mulchFactor
// (cropCoefficient fixed at 1, matching the real simulation's current
// hardcoding in daily-step-orchestrator.ts — do not diverge from that here).
export function estimateEvapotranspirationDisplayMm(input: { meanTempC: number; mulchDepthMm: number }): number {
  return estimateReferenceEt0Mm(input.meanTempC) * mulchFactorFromDepth(input.mulchDepthMm);
}

export interface WaterBucketInputs {
  soilMoistureFraction: number; // 0 = wilting point, 1 = field capacity
  rainMm: number;
  irrigationMm: number;
  et0Mm: number; // reference evapotranspiration for the day
  cropCoefficient: number; // Kc
  mulchFactor: number; // 1 = no mulch, lower = more evaporation suppression
  fieldCapacityFraction: number;
  wiltingPointFraction: number;
}

export interface WaterBucketResult {
  soilMoistureFraction: number;
  evapotranspirationMm: number;
  drainageMm: number;
  runoffMm: number;
}

// One simulated day of soil moisture: rain + irrigation in, ET out, excess
// above field capacity drains off (with a small same-day runoff cap above
// that). soilMoistureFraction can briefly land above 1 before drainage
// fully catches up on a later day — see the CellEnvironmentState schema
// comment.
export function stepWaterBucket(inputs: WaterBucketInputs): WaterBucketResult {
  const fieldCapacityMm = inputs.fieldCapacityFraction * ROOT_ZONE_DEPTH_MM;
  const wiltingPointMm = inputs.wiltingPointFraction * ROOT_ZONE_DEPTH_MM;
  const range = Math.max(fieldCapacityMm - wiltingPointMm, 1);
  const currentMm = wiltingPointMm + inputs.soilMoistureFraction * range;

  const etDemandMm = Math.max(inputs.et0Mm, 0) * inputs.cropCoefficient * inputs.mulchFactor;
  const beforeDrainageMm =
    currentMm + Math.max(inputs.rainMm, 0) + Math.max(inputs.irrigationMm, 0) - etDemandMm;

  // Saturation ceiling: real soil can briefly hold a bit more than field
  // capacity before gravity drains the excess out same-day — a small
  // headroom above fieldCapacityMm, not unbounded storage. Anything above
  // that headroom is lost as runoff rather than stored at all.
  const saturationMm = fieldCapacityMm * 1.15;
  const cappedMm = Math.min(beforeDrainageMm, saturationMm);
  const runoffMm = Math.max(beforeDrainageMm - saturationMm, 0);

  // A texture-independent flat drainage rate for this simplified
  // single-bucket model (a texture-dependent coefficient is a later-phase
  // refinement, see the architecture doc's §5): half the excess above field
  // capacity drains out per day.
  const excessAboveCapacity = Math.max(cappedMm - fieldCapacityMm, 0);
  const drainageMm = excessAboveCapacity * 0.5;
  const finalMm = Math.max(cappedMm - drainageMm, wiltingPointMm);

  const availableMm = Math.max(currentMm - wiltingPointMm, 0) + Math.max(inputs.rainMm, 0) + Math.max(inputs.irrigationMm, 0);

  return {
    soilMoistureFraction: (finalMm - wiltingPointMm) / range,
    evapotranspirationMm: Math.min(etDemandMm, availableMm),
    drainageMm,
    runoffMm,
  };
}

// Exponential smoothing toward mean air temperature — soil lags air temp,
// more so under mulch. mulchDampening: 1 = no mulch (fast equilibration),
// lower = slower (mulch's real-world temperature-buffering effect).
export function stepSoilTemperature(
  currentSoilTempC: number,
  airMeanTempC: number,
  mulchDampening: number,
): number {
  const k = 0.3 * mulchDampening;
  return currentSoilTempC + k * (airMeanTempC - currentSoilTempC);
}

// A standard published figure for mulch's evaporation-suppression effect
// (architecture doc §4: "reduces evaporation ~30-50%") — depth-scaled up to
// that ceiling rather than an on/off flag, so a thin layer helps a little
// and a deep layer helps close to the full amount. Converts
// CellEnvironmentState.mulchDepthMm into the mulchFactor stepWaterBucket
// already accepts but every caller previously hardcoded to 1.
const MULCH_DEPTH_FOR_MAX_EFFECT_MM = 50;
const MULCH_MAX_EVAPORATION_SUPPRESSION = 0.4;

export function mulchFactorFromDepth(mulchDepthMm: number): number {
  const depthFraction = Math.min(1, Math.max(0, mulchDepthMm) / MULCH_DEPTH_FOR_MAX_EFFECT_MM);
  return 1 - depthFraction * MULCH_MAX_EVAPORATION_SUPPRESSION;
}

// Mirrors mulchFactorFromDepth for stepSoilTemperature's mulchDampening
// parameter — mulch buffers soil-temp swings (§4), so deeper mulch means a
// smaller dampening multiplier (slower equilibration toward air temp).
const MULCH_MAX_TEMP_DAMPENING = 0.5;

export function mulchDampeningFromDepth(mulchDepthMm: number): number {
  const depthFraction = Math.min(1, Math.max(0, mulchDepthMm) / MULCH_DEPTH_FOR_MAX_EFFECT_MM);
  return 1 - depthFraction * MULCH_MAX_TEMP_DAMPENING;
}
