// One simulated day's full pipeline for one planting: water -> nutrients ->
// stress -> growth, with mulch and companion-planting ecology folded in at
// the right point of each step. Both real callers (catch-up-service.ts) and
// hypothetical callers (whatif-projection-service.ts) run this exact
// function so they can never silently drift apart as the pipeline grows —
// the "one core simulation function, two callers" principle
// whatif-projection-service.ts's own header comment already establishes.
// Pure and cheap: every input is a plain value, no I/O.

import type { DailyWeather } from "@/domain/weather/weather-provider";
import {
  estimateReferenceEt0Mm,
  mulchDampeningFromDepth,
  mulchFactorFromDepth,
  stepSoilTemperature,
  stepWaterBucket,
} from "@/domain/soil/water-bucket-service";
import { stepNutrientPools, type NutrientPoolState } from "@/domain/soil/nutrient-service";
import { stepWeedPressure, weedCompetitionPenalty } from "@/domain/soil/weed-pressure-service";
import { stepDaysNearSaturation, type BaselineLightLevel, type StressDials } from "./stress-service";
import type { EcologyModifiers } from "@/domain/ecology/ecology-service";
import type { DiseaseInstanceEffect } from "@/domain/disease/disease-service";
import type { PestDamageEffect } from "@/domain/pests/pest-service";
import {
  NUTRIENT_DEMAND_BY_STAGE,
  stepDailyGrowth,
  type BiologyState,
  type SpeciesGrowthParams,
} from "./growth-engine-service";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// A moderate baseline pollinator presence before any companion boost or
// weather suppression is applied — SELF/WIND-dependent species never read
// this value (growth-engine-service.ts's effectiveAllocation only gates
// INSECT-dependent species), so it's always safe to compute unconditionally.
const BASELINE_POLLINATOR_ACTIVITY = 0.5;
const RAIN_SUPPRESSION_NORMALIZING_MM = 20;
const RAIN_SUPPRESSION_MAX = 0.4;
const COLD_SUPPRESSION_THRESHOLD_C = 12;
const COLD_SUPPRESSION_MAX = 0.4;

function computePollinatorActivity(weather: DailyWeather, ecologyModifiers: EcologyModifiers): number {
  const meanTempC = (weather.tempHighC + weather.tempLowC) / 2;
  const rainSuppression = clamp01(weather.precipitationMm / RAIN_SUPPRESSION_NORMALIZING_MM) * RAIN_SUPPRESSION_MAX;
  const coldSuppression =
    clamp01((COLD_SUPPRESSION_THRESHOLD_C - meanTempC) / COLD_SUPPRESSION_THRESHOLD_C) * COLD_SUPPRESSION_MAX;
  return clamp01(BASELINE_POLLINATOR_ACTIVITY + ecologyModifiers.pollinatorBoost - rainSuppression - coldSuppression);
}

export interface DailyEnvironmentState extends NutrientPoolState {
  soilMoistureFraction: number;
  soilTempC: number;
  mulchDepthMm: number;
  daysNearSaturation: number;
  weedPressureFraction: number;
}

export interface DailyStepInputs {
  species: SpeciesGrowthParams;
  biology: BiologyState;
  weather: DailyWeather; // already passed through applyConditionModifiers by the caller
  soilProfile: { fieldCapacityFraction: number; wiltingPointFraction: number };
  environment: DailyEnvironmentState;
  baselineLight: BaselineLightLevel;
  plantingAgeDays: number;
  ecologyModifiers: EcologyModifiers;
  // Phase 3 (SPEC-GROWTH-003): the planting's currently-active disease
  // episode's per-day effect (NEUTRAL_DISEASE_EFFECT when none is active),
  // the bed's pest-pressure dial value for this planting's growth habit,
  // and that same pest population's direct damage — all resolved by the
  // caller (catch-up-service.ts) from DiseaseInfection/PestPopulation state,
  // same "soil/disease/pests are dependencies OF growth" direction the rest
  // of this file already follows.
  activeDiseaseEffect: DiseaseInstanceEffect;
  pestPressureDialValue: number;
  pestDamage: PestDamageEffect;
}

export interface DailyStepResult {
  biology: BiologyState;
  environment: DailyEnvironmentState;
  stress: StressDials;
}

export function runOneDayForPlanting(inputs: DailyStepInputs): DailyStepResult {
  const mulchFactor = mulchFactorFromDepth(inputs.environment.mulchDepthMm);
  const mulchDampening = mulchDampeningFromDepth(inputs.environment.mulchDepthMm);
  const meanTempC = (inputs.weather.tempHighC + inputs.weather.tempLowC) / 2;

  const waterResult = stepWaterBucket({
    soilMoistureFraction: inputs.environment.soilMoistureFraction,
    rainMm: inputs.weather.precipitationMm,
    // Real irrigation inflow is wired into this bucket by the caller before
    // reaching this orchestrator in a later phase; Phase 2 still models
    // rain only, same as Phase 1.
    irrigationMm: 0,
    et0Mm: estimateReferenceEt0Mm(meanTempC),
    cropCoefficient: 1,
    mulchFactor,
    fieldCapacityFraction: inputs.soilProfile.fieldCapacityFraction,
    wiltingPointFraction: inputs.soilProfile.wiltingPointFraction,
  });
  const soilTempC = stepSoilTemperature(inputs.environment.soilTempC, meanTempC, mulchDampening);
  const daysNearSaturation = stepDaysNearSaturation(inputs.environment.daysNearSaturation, waterResult.soilMoistureFraction);
  const weedPressureFraction = stepWeedPressure({
    weedPressureFraction: inputs.environment.weedPressureFraction,
    mulchFactor,
    soilMoistureFraction: waterResult.soilMoistureFraction,
    soilTempC,
  });

  const stageDemand = NUTRIENT_DEMAND_BY_STAGE[inputs.biology.phenologyStage];
  const demandScale = inputs.species.baseNutrientDemand;
  // Root rot (disease-catalog.ts) reduces effective root FUNCTION, not root
  // BIOMASS — the roots still exist (rootFraction itself is untouched, see
  // growth-engine-service.ts), they just draw less nutrient this step.
  const effectiveRootFraction = inputs.biology.rootFraction * (1 - clamp01(inputs.activeDiseaseEffect.rootFunctionPenalty));
  const nutrientResult = stepNutrientPools({
    pools: inputs.environment,
    soilMoistureFraction: waterResult.soilMoistureFraction,
    soilTempC,
    drainageMm: waterResult.drainageMm,
    rootFraction: effectiveRootFraction,
    demand: {
      n: stageDemand.n * demandScale,
      p: stageDemand.p * demandScale,
      k: stageDemand.k * demandScale,
      ca: stageDemand.ca * demandScale,
    },
  });
  // A nitrogen-fixing companion (pole-bean, companion-catalog.ts) trickles
  // directly into the pool, on top of whatever uptake/leaching/decomposition
  // already happened this step — a small daily bonus, not routed through
  // the demand/uptake math above.
  const nitrogenPoolFraction = clamp01(nutrientResult.pools.nitrogenPoolFraction + inputs.ecologyModifiers.nitrogenTrickle);

  const pollinatorActivity = computePollinatorActivity(inputs.weather, inputs.ecologyModifiers);

  const pestDiseaseSeverity = Math.max(inputs.activeDiseaseEffect.severityDialValue, inputs.pestPressureDialValue);

  const growthResult = stepDailyGrowth(inputs.species, inputs.biology, inputs.weather, {
    soilMoistureFraction: waterResult.soilMoistureFraction,
    daysNearSaturation,
    baselineLight: inputs.baselineLight,
    nutrientSatisfaction: nutrientResult.nutrientSatisfaction,
    plantingAgeDays: inputs.plantingAgeDays,
    pollinatorActivity,
    allelopathicPenalty: inputs.ecologyModifiers.allelopathicPenalty,
    pestDiseaseSeverity,
    diseaseLightPenalty: inputs.activeDiseaseEffect.lightPenalty,
    directEffects: {
      energyIncomePenalty: inputs.pestDamage.energyPenalty,
      directBiomassLossFraction: clamp01(inputs.pestDamage.leafLossFraction + inputs.activeDiseaseEffect.biomassLossFraction),
      weedCompetitionPenalty: weedCompetitionPenalty(weedPressureFraction),
    },
  });

  return {
    biology: growthResult.biology,
    environment: {
      soilMoistureFraction: waterResult.soilMoistureFraction,
      soilTempC,
      nitrogenPoolFraction,
      phosphorusPoolFraction: nutrientResult.pools.phosphorusPoolFraction,
      potassiumPoolFraction: nutrientResult.pools.potassiumPoolFraction,
      calciumPoolFraction: nutrientResult.pools.calciumPoolFraction,
      micronutrientIndexFraction: nutrientResult.pools.micronutrientIndexFraction,
      residueOrganicMatterPool: nutrientResult.pools.residueOrganicMatterPool,
      mulchDepthMm: inputs.environment.mulchDepthMm,
      daysNearSaturation,
      weedPressureFraction,
    },
    stress: growthResult.stress,
  };
}
