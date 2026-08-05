// Manual growth-stage override: resets a planting's BiologyState to the same
// zero-state a brand-new planting starts from (schema.prisma's
// PlantingBiologyState column defaults), then replays the existing, pure
// stepDailyGrowth() day-by-day under idealized/neutral conditions until
// accumulatedGdd crosses the target stage's species GDD threshold. This is a
// new caller of stepDailyGrowth, not a modification of it — growth-engine
// math stays exclusively in growth-engine-service.ts.

import type { PrismaClient } from "@prisma/client";
import {
  NEUTRAL_DIRECT_EFFECTS,
  stepDailyGrowth,
  type BiologyState,
  type DailyEnvironmentInputs,
  type PhenologyStage,
  type SpeciesGrowthParams,
} from "./growth-engine-service";
import type { DailyWeather } from "@/domain/weather/weather-provider";
import { getFallbackSpeciesProfile } from "./species-catalog";
import { getCurrentSimTime } from "./sim-clock-service";
import { InvalidTargetStageError, PlantingNotFoundError, PlantingRemovedError } from "./errors";

// The five stages reachable via a GDD-threshold replay — SENESCENT/DEAD are
// exogenous terminal states nextPhenologyStage() never derives from
// accumulatedGdd, so they're not valid override targets (NC-SPRIG-GROWTH5-NO-TERMINAL-REPLAY).
const OVERRIDABLE_STAGES: readonly PhenologyStage[] = ["GERMINATING", "VEGETATIVE", "FLOWERING", "FRUITING", "MATURE"];

// A local mirror of growth-engine-service.ts's module-private
// nextPhenologyStage stage order — that function isn't exported (and
// growth-engine-service.ts is out of scope to modify), so this ordering
// table is duplicated here just to know when the replay loop has reached its
// target. Same "local mirror over cross-domain import" precedent
// grid-cell-service.ts and components/garden/growth-progress.ts already
// establish for this exact situation.
const STAGE_RANK: Record<PhenologyStage, number> = {
  GERMINATING: 0,
  VEGETATIVE: 1,
  FLOWERING: 2,
  FRUITING: 3,
  MATURE: 4,
  SENESCENT: 5,
  DEAD: 5,
};

// Matches prisma/schema.prisma's PlantingBiologyState column defaults
// exactly — the same zero-state catch-up-service.ts's no-explicit-field
// create() call relies on implicitly for a brand-new planting.
const ZERO_STATE_BIOLOGY: BiologyState = {
  accumulatedGdd: 0,
  phenologyStage: "GERMINATING",
  leafFraction: 0.05,
  stemFraction: 0.05,
  rootFraction: 0.1,
  flowerFraction: 0,
  fruitFraction: 0,
  storedReserves: 0.2,
  waterContentIndex: 1,
  cumulativeStress: 0,
};

// stress-service.ts's transplantShock = exp(-plantingAgeDays / 3) is 1.0 (max
// stress) at plantingAgeDays = 0, not 0 — held fixed at a value well past its
// decay window for every replay day so the replay stays genuinely
// stress-free throughout, rather than injecting artificial shock stress on
// its first simulated days.
const NEUTRAL_PLANTING_AGE_DAYS = 60;

const NEUTRAL_ENVIRONMENT_BASE: Omit<DailyEnvironmentInputs, "plantingAgeDays"> = {
  soilMoistureFraction: 1,
  daysNearSaturation: 0,
  baselineLight: "FULL_SUN",
  nutrientSatisfaction: { n: 1, p: 1, k: 1, ca: 1 },
  pollinatorActivity: 1,
  allelopathicPenalty: 0,
  pestDiseaseSeverity: 0,
  diseaseLightPenalty: 0,
  directEffects: NEUTRAL_DIRECT_EFFECTS,
};

// A generous safety cap mirroring catch-up-service.ts's MAX_CATCH_UP_DAYS
// defensive-cap pattern — should be unreachable given neutralWeatherFor's own
// guard already guarantees strictly positive daily GDD, but documents the
// invariant rather than looping forever on unexpectedly pathological data.
const MAX_REPLAY_DAYS = 3650;

function neutralWeatherFor(species: SpeciesGrowthParams, date: Date): DailyWeather {
  const meanC = (species.coldStressThresholdC + species.heatStressThresholdC) / 2;
  if (meanC <= species.baseTempC) {
    throw new Error(
      `Species data can't produce a neutral replay day: comfortable-range midpoint (${meanC}C) is not above baseTempC (${species.baseTempC}C).`,
    );
  }
  return {
    date,
    tempHighC: meanC,
    tempLowC: meanC,
    precipitationMm: 0,
    cloudCoverPct: 0,
    humidityPct: 50,
    windSpeedKph: 0,
    condition: "Clear",
  };
}

function startOfUtcDay(date: Date): Date {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function replayToStage(species: SpeciesGrowthParams, targetStage: PhenologyStage): BiologyState {
  let biology = ZERO_STATE_BIOLOGY;
  const replayDate = new Date(0);
  let day = 0;
  while (STAGE_RANK[biology.phenologyStage] < STAGE_RANK[targetStage]) {
    if (day >= MAX_REPLAY_DAYS) {
      throw new Error(`Replay to ${targetStage} did not converge within ${MAX_REPLAY_DAYS} simulated days.`);
    }
    const weather = neutralWeatherFor(species, replayDate);
    const environment: DailyEnvironmentInputs = { ...NEUTRAL_ENVIRONMENT_BASE, plantingAgeDays: NEUTRAL_PLANTING_AGE_DAYS };
    const result = stepDailyGrowth(species, biology, weather, environment);
    biology = result.biology;
    day += 1;
  }
  // Explicit clean-slate reset regardless of what the replay itself produced
  // (NC-SPRIG-GROWTH5-CLEAN-SLATE-RESET) — belt-and-suspenders alongside the
  // neutral inputs above, not a substitute for them.
  return { ...biology, waterContentIndex: 1, cumulativeStress: 0 };
}

export async function overridePlantingStage(
  prisma: PrismaClient,
  input: { cellPlantingId: string; targetStage: PhenologyStage },
): Promise<{ biology: BiologyState }> {
  if (!OVERRIDABLE_STAGES.includes(input.targetStage)) {
    throw new InvalidTargetStageError(
      `Cannot override to ${input.targetStage}; only GERMINATING, VEGETATIVE, FLOWERING, FRUITING, and MATURE are reachable via replay.`,
    );
  }

  const planting = await prisma.cellPlanting.findUnique({
    where: { id: input.cellPlantingId },
    include: { plant: { include: { speciesProfile: true } } },
  });
  if (!planting) {
    throw new PlantingNotFoundError(`No planting found for id ${input.cellPlantingId}.`);
  }
  if (planting.removedAt) {
    throw new PlantingRemovedError(`Planting ${input.cellPlantingId} has already been finished and can't be overridden.`);
  }

  const species: SpeciesGrowthParams = planting.plant.speciesProfile ?? (await getFallbackSpeciesProfile(prisma));
  const replayed = replayToStage(species, input.targetStage);

  const clock = await getCurrentSimTime(prisma);
  const today = startOfUtcDay(clock.simTime);

  await prisma.plantingBiologyState.upsert({
    where: { cellPlantingId: input.cellPlantingId },
    create: { cellPlantingId: input.cellPlantingId, ...replayed, dominantStressDial: null, updatedThroughDate: today },
    update: { ...replayed, dominantStressDial: null, updatedThroughDate: today },
  });

  return { biology: replayed };
}
