// The core growth engine: one simulated day's worth of Growing Degree Day
// accumulation, phenology transition, an energy-proxy photosynthesis vs.
// respiration budget, Liebig's-Law stress combination, and carbon
// allocation across biomass pools. Pure and cheap by design — every input
// is a plain value, every output is a plain value, no I/O — so this exact
// function can be called both by the real catch-up step
// (catch-up-service.ts) and, later, by a what-if projection, without two
// divergent growth models. See the architecture doc's §6/§8/§14.

import type { DailyWeather } from "@/domain/weather/weather-provider";
import {
  combineStress,
  computeStressDials,
  type BaselineLightLevel,
  type NutrientSatisfaction,
  type StressDials,
} from "./stress-service";

export type PhenologyStage =
  | "GERMINATING"
  | "VEGETATIVE"
  | "FLOWERING"
  | "FRUITING"
  | "MATURE"
  | "SENESCENT"
  | "DEAD";

export type PollinationDependency = "SELF" | "WIND" | "INSECT";

export interface SpeciesGrowthParams {
  baseTempC: number;
  gddToGerminate: number;
  gddToVegetative: number;
  gddToFlowering: number;
  gddToFruiting: number;
  gddToMaturity: number;
  heatStressThresholdC: number;
  coldStressThresholdC: number;
  droughtComfortFraction: number;
  lightNeedFraction: number;
  windLodgingThresholdKph: number;
  baseNutrientDemand: number;
  pollinationDependency: PollinationDependency;
}

// The per-day environment inputs stepDailyGrowth needs beyond weather
// itself — everything stress-service.ts's 8 dials and the pollination gate
// depend on, assembled by the caller (daily-step-orchestrator.ts) from the
// water/nutrient/ecology steps that already ran that day. Bundled into one
// object rather than growing stepDailyGrowth's positional-argument list
// further as Phase 2 added five more stress inputs.
export interface DailyEnvironmentInputs {
  soilMoistureFraction: number;
  daysNearSaturation: number;
  baselineLight: BaselineLightLevel;
  nutrientSatisfaction: NutrientSatisfaction;
  plantingAgeDays: number;
  // 0..1. Callers pass 1 for SELF/WIND-dependent species (never gated);
  // INSECT-dependent species pass the ecology domain's computed value
  // (companion pollinator-boost sources + weather suppression). See §11.
  pollinatorActivity: number;
  // 0..1, from ecology-service.ts's EcologyModifiers.allelopathicPenalty
  // (currently always 0 — no antagonistic species is seeded yet, see
  // companion-catalog.ts). Chemical growth inhibition isn't a
  // resource-scarcity dial, so it multiplies growthPenalty directly rather
  // than joining stress-service.ts's Liebig combination.
  allelopathicPenalty: number;
  // --- Phase 3 (SPEC-GROWTH-003) ---
  // 0..1, max(active-disease severity, bed pest pressure) — feeds
  // StressDials.pestDisease via stress-service.ts's Liebig combination.
  pestDiseaseSeverity: number;
  // 0..1, mildew-style effective-light reduction from the planting's
  // active disease (disease-catalog.ts's DiseaseEffect.lightPenalty x
  // severity) — distinct from the dial above because it acts on the light
  // curve specifically, not general vigor.
  diseaseLightPenalty: number;
  // Effects that don't fit stress-service.ts's resource-scarcity Liebig
  // shape: a direct efficiency tax (aphid sap-feeding), a direct removal of
  // existing foliage biomass (caterpillar/slug eating, blight lesions), and
  // weed competition — see DirectVigorEffects below.
  directEffects: DirectVigorEffects;
}

export interface DirectVigorEffects {
  // 0..1 extra multiplicative penalty on energyIncome, beyond growthPenalty
  // (architecture doc §10: aphids "sap energy income" rather than eating
  // biomass).
  energyIncomePenalty: number;
  // 0..1 fraction of CURRENT leaf+stem biomass removed today (caterpillar/
  // slug leaf-eating and blight's direct biomass-loss term, combined into
  // one channel — architecture doc §9/§10's "different diseases/pests
  // visibly manifest differently," applied here as an actual pool
  // reduction rather than a growth-rate penalty).
  directBiomassLossFraction: number;
  // 0..1, weed-pressure-service.ts's weedCompetitionPenalty — competition
  // for light/water/nutrients, the same multiplicative treatment
  // allelopathicPenalty gets rather than a Liebig dial of its own.
  weedCompetitionPenalty: number;
}

export const NEUTRAL_DIRECT_EFFECTS: DirectVigorEffects = {
  energyIncomePenalty: 0,
  directBiomassLossFraction: 0,
  weedCompetitionPenalty: 0,
};

export interface BiologyState {
  accumulatedGdd: number;
  phenologyStage: PhenologyStage;
  leafFraction: number;
  stemFraction: number;
  rootFraction: number;
  flowerFraction: number;
  fruitFraction: number;
  storedReserves: number;
  waterContentIndex: number;
  cumulativeStress: number;
}

export interface DailyGrowthResult {
  biology: BiologyState;
  stress: StressDials;
}

// How far (in °C) beyond a species' comfortable range counts as "fully
// maxed out" stress for that dial — a normalizing constant, not a
// physiological constant.
const STRESS_NORMALIZING_RANGE_C = 12;
// Exponential-moving-average weight kept from the prior day's cumulative
// stress: high enough that one bad day barely moves it, low enough that a
// sustained bad week compounds (the architecture doc's §8/§15 "forgive
// spikes, respect trends" principle).
const CUMULATIVE_STRESS_DECAY = 0.85;
const RESERVE_DRAIN_HEALTH_PENALTY = 0.05;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Growing Degree Days for the day: heat accumulation above the species'
// base temperature, never negative.
export function dailyGdd(tempHighC: number, tempLowC: number, baseTempC: number): number {
  const meanC = (tempHighC + tempLowC) / 2;
  return Math.max(0, meanC - baseTempC);
}

// GERMINATING is reused for "planted, not yet past emergence" — the
// distinct visual/status difference between that and "past emergence"
// (SPEC-GRID-001's GERMINATED CellStatus) is derived by the caller from
// accumulatedGdd vs. gddToGerminate, not tracked as a separate stage here.
// DEAD/SENESCENT are terminal for this function: nothing advances a dead or
// senescent planting further via the daily step (a human clear/remove
// action is what eventually retires it).
function nextPhenologyStage(
  stage: PhenologyStage,
  accumulatedGdd: number,
  species: SpeciesGrowthParams,
): PhenologyStage {
  if (stage === "DEAD" || stage === "SENESCENT") {
    return stage;
  }
  if (accumulatedGdd >= species.gddToMaturity) return "MATURE";
  if (accumulatedGdd >= species.gddToFruiting) return "FRUITING";
  if (accumulatedGdd >= species.gddToFlowering) return "FLOWERING";
  if (accumulatedGdd >= species.gddToVegetative) return "VEGETATIVE";
  return "GERMINATING";
}

// Rectangular-hyperbola light-response curve: saturating, never linear —
// "more sun is always better" is the wrong shape for real photosynthesis.
function lightResponse(effectiveLight: number): number {
  const halfSaturation = 0.4;
  return effectiveLight / (effectiveLight + halfSaturation);
}

// An asymmetric bell curve built from the species' two stress thresholds:
// full efficiency inside its comfortable range, falling off beyond either
// edge. This single curve is what makes a heat-loving and a cool-loving
// species respond differently to identical weather.
function temperatureResponse(tempC: number, species: SpeciesGrowthParams): number {
  if (tempC >= species.coldStressThresholdC && tempC <= species.heatStressThresholdC) {
    return 1;
  }
  const distance =
    tempC < species.coldStressThresholdC
      ? species.coldStressThresholdC - tempC
      : tempC - species.heatStressThresholdC;
  return clamp01(1 - distance / STRESS_NORMALIZING_RANGE_C);
}

// Stage-shaped nutrient demand weights (vegetative wants more N, fruiting
// wants more K — architecture doc §7), the same "shared shape in code,
// per-species scalar in DB" split ALLOCATION_BY_STAGE below already uses.
// Lives here (growth domain), not nutrient-service.ts (soil domain),
// because it's keyed by PhenologyStage — soil stays a dependency OF growth,
// never the reverse, matching water-bucket-service.ts's existing direction.
// The orchestrator multiplies these by species.baseNutrientDemand before
// calling stepNutrientPools.
export const NUTRIENT_DEMAND_BY_STAGE: Record<PhenologyStage, { n: number; p: number; k: number; ca: number }> = {
  GERMINATING: { n: 0.3, p: 0.3, k: 0.2, ca: 0.1 },
  VEGETATIVE: { n: 1, p: 0.4, k: 0.5, ca: 0.3 },
  FLOWERING: { n: 0.6, p: 0.7, k: 0.7, ca: 0.5 },
  FRUITING: { n: 0.4, p: 0.5, k: 1, ca: 0.8 },
  MATURE: { n: 0.2, p: 0.2, k: 0.4, ca: 0.4 },
  SENESCENT: { n: 0, p: 0, k: 0, ca: 0 },
  DEAD: { n: 0, p: 0, k: 0, ca: 0 },
};

// Carbon allocation weights by phenology stage: a config table per stage,
// not per species — every species shares the same *shape* of allocation
// shift (roots first, then leaves, then flowers/fruit); only the GDD
// thresholds that trigger each stage differ per species (SpeciesProfile).
const ALLOCATION_BY_STAGE: Record<
  PhenologyStage,
  { leaf: number; stem: number; root: number; flower: number; fruit: number }
> = {
  GERMINATING: { leaf: 0.2, stem: 0.1, root: 0.7, flower: 0, fruit: 0 },
  VEGETATIVE: { leaf: 0.45, stem: 0.25, root: 0.3, flower: 0, fruit: 0 },
  FLOWERING: { leaf: 0.3, stem: 0.2, root: 0.15, flower: 0.35, fruit: 0 },
  FRUITING: { leaf: 0.15, stem: 0.1, root: 0.1, flower: 0.1, fruit: 0.55 },
  MATURE: { leaf: 0.1, stem: 0.05, root: 0.05, flower: 0.1, fruit: 0.7 },
  SENESCENT: { leaf: 0, stem: 0, root: 0, flower: 0, fruit: 0 },
  DEAD: { leaf: 0, stem: 0, root: 0, flower: 0, fruit: 0 },
};

const DEAD_STRESS_DIALS: StressDials = {
  heat: 0,
  cold: 0,
  drought: 0,
  overwater: 0,
  shade: 0,
  nutrient: 0,
  transplantShock: 0,
  wind: 0,
  pestDisease: 0,
};

// Pollination gate (architecture doc §11): INSECT-dependent species convert
// flower -> fruit in proportion to pollinatorActivity; the unconverted
// share stays in the flower pool instead of vanishing, so poor pollination
// visibly reads as "lots of flowers, little fruit" rather than stalled
// growth. SELF/WIND-dependent species are never gated.
function effectiveAllocation(
  stage: PhenologyStage,
  species: SpeciesGrowthParams,
  pollinatorActivity: number,
): { leaf: number; stem: number; root: number; flower: number; fruit: number } {
  const base = ALLOCATION_BY_STAGE[stage];
  const isGatedStage = stage === "FLOWERING" || stage === "FRUITING";
  if (species.pollinationDependency !== "INSECT" || !isGatedStage) {
    return base;
  }
  const factor = clamp01(pollinatorActivity);
  const convertedFruit = base.fruit * factor;
  return { ...base, fruit: convertedFruit, flower: base.flower + (base.fruit - convertedFruit) };
}

export function stepDailyGrowth(
  species: SpeciesGrowthParams,
  biology: BiologyState,
  weather: DailyWeather,
  environment: DailyEnvironmentInputs,
): DailyGrowthResult {
  if (biology.phenologyStage === "DEAD") {
    return { biology, stress: DEAD_STRESS_DIALS };
  }

  const gdd = dailyGdd(weather.tempHighC, weather.tempLowC, species.baseTempC);
  const accumulatedGdd = biology.accumulatedGdd + gdd;
  const stress = computeStressDials({
    weather,
    soilMoistureFraction: environment.soilMoistureFraction,
    daysNearSaturation: environment.daysNearSaturation,
    baselineLight: environment.baselineLight,
    nutrientSatisfaction: environment.nutrientSatisfaction,
    plantingAgeDays: environment.plantingAgeDays,
    species,
    pestDiseaseSeverity: environment.pestDiseaseSeverity,
  });

  const limitingStress = combineStress(stress);
  const growthPenalty =
    (1 - limitingStress) *
    (1 - clamp01(environment.allelopathicPenalty)) *
    (1 - clamp01(environment.directEffects.weedCompetitionPenalty));

  const meanTempC = (weather.tempHighC + weather.tempLowC) / 2;
  // A larger existing canopy shades its own lower leaves slightly — a
  // cheap, small self-shading term, not a full canopy-layer model. Mildew
  // (or another light-blocking disease)'s diseaseLightPenalty stacks on top
  // of self-shading, not instead of it.
  const effectiveLight =
    clamp01(1 - weather.cloudCoverPct / 100) * (1 - biology.leafFraction * 0.1) * (1 - clamp01(environment.diseaseLightPenalty));
  const energyIncome =
    lightResponse(effectiveLight) *
    temperatureResponse(meanTempC, species) *
    growthPenalty *
    (1 - clamp01(environment.directEffects.energyIncomePenalty)) *
    0.06;
  const totalBiomass =
    biology.leafFraction + biology.stemFraction + biology.rootFraction + biology.flowerFraction + biology.fruitFraction;
  const maintenanceCost = totalBiomass * 0.015;
  const netEnergy = energyIncome - maintenanceCost;

  let storedReserves = biology.storedReserves;
  let cumulativeStress = biology.cumulativeStress * CUMULATIVE_STRESS_DECAY + limitingStress * (1 - CUMULATIVE_STRESS_DECAY);
  let growthBudget = 0;

  if (netEnergy >= 0) {
    // A portion of surplus banks as reserve, the rest is available to grow
    // today — reserves exist so one bad day doesn't stall growth outright.
    storedReserves = Math.min(1, storedReserves + netEnergy * 0.3);
    growthBudget = netEnergy * 0.7;
  } else {
    const deficit = -netEnergy;
    const drawnFromReserves = Math.min(storedReserves, deficit);
    storedReserves -= drawnFromReserves;
    const unmetDeficit = deficit - drawnFromReserves;
    if (unmetDeficit > 0) {
      // Reserves exhausted: real starvation, not just "no growth today" —
      // shows up as extra cumulative stress on top of the day's own
      // weather-driven stress.
      cumulativeStress = clamp01(cumulativeStress + unmetDeficit * RESERVE_DRAIN_HEALTH_PENALTY);
    }
  }

  const allocation = effectiveAllocation(biology.phenologyStage, species, environment.pollinatorActivity);
  // Direct foliage loss (caterpillar/slug eating, blight lesions) is applied
  // proportionally to today's leaf/stem pools AFTER today's growth
  // allocation — pests/disease eat both standing and freshly-grown tissue
  // together, a documented simplification rather than tracking "old" vs.
  // "new" biomass separately.
  const foliageSurvivalFraction = 1 - clamp01(environment.directEffects.directBiomassLossFraction);
  const leafFraction = clamp01((biology.leafFraction + growthBudget * allocation.leaf) * foliageSurvivalFraction);
  const stemFraction = clamp01((biology.stemFraction + growthBudget * allocation.stem) * foliageSurvivalFraction);
  const rootFraction = clamp01(biology.rootFraction + growthBudget * allocation.root);
  const flowerFraction = clamp01(biology.flowerFraction + growthBudget * allocation.flower);
  const fruitFraction = clamp01(biology.fruitFraction + growthBudget * allocation.fruit);

  // Fast-reacting turgor/wilt signal: tracks drought stress directly rather
  // than lagging like biomass does, so a plant can visibly wilt today and
  // visibly recover tomorrow without its slower biomass history changing.
  const waterContentIndex = clamp01(1 - stress.drought * 0.8);

  // Sustained starvation (reserves empty for long enough that
  // cumulativeStress pins near its ceiling) is the one thing this daily
  // step can kill a planting over — everything else just slows or stalls
  // growth. Recovery is possible right up until this point: cumulative
  // stress decaying back down before reserves hit zero means the planting
  // never crosses into DEAD.
  const phenologyStage =
    cumulativeStress > 0.95 && storedReserves <= 0
      ? "DEAD"
      : nextPhenologyStage(biology.phenologyStage, accumulatedGdd, species);

  return {
    biology: {
      accumulatedGdd,
      phenologyStage,
      leafFraction,
      stemFraction,
      rootFraction,
      flowerFraction,
      fruitFraction,
      storedReserves,
      waterContentIndex,
      cumulativeStress,
    },
    stress,
  };
}
