// The "test conditions" / what-if mode from the architecture doc's §19:
// runs the SAME daily growth step the real catch-up uses
// (src/domain/growth/growth-engine-service.ts), forward `projectionDays`
// simulated days, starting from each targeted planting's CURRENT real
// state — but never writes any of it back to
// PlantingBiologyState/CellEnvironmentState/GridCell/GridCellEvent
// (NC-SPRIG-NO-OVERWRITE-JOURNAL, the same rule the existing
// src/domain/simulation what-if overlay already follows). One core
// simulation function, two callers: real catch-up (committed) and this
// projection (hypothetical, discarded).
//
// Deliberately NOT built on top of the existing SimulationRun/
// SPEC-VIEWER-00x scenario FSM: that machinery exists for a different,
// not-yet-wired-to-any-UI feature (a real/simulated time-of-day scrub for
// the 3D viewer). Forcing this feature through it would mean persisting
// DRAFT/CONFIGURED/RUNNING state for something that's cheap and
// deterministic enough to just recompute on demand — see the "why
// in-memory, not a table of projected days" note in the architecture
// doc's §19.

import type { PrismaClient } from "@prisma/client";
import { getGardenLocation } from "@/domain/lighting/garden-location";
import { getOrGenerateWeatherDay } from "@/domain/weather/weather-service";
import { getOrCreateSoilProfile } from "@/domain/soil/soil-profile-service";
import type { BiologyState, SpeciesGrowthParams } from "@/domain/growth/growth-engine-service";
import { runOneDayForPlanting, type DailyEnvironmentState } from "@/domain/growth/daily-step-orchestrator";
import { NEUTRAL_DISEASE_EFFECT } from "@/domain/disease/disease-service";
import { NEUTRAL_PEST_DAMAGE } from "@/domain/pests/pest-service";
import { getFallbackSpeciesProfile, guessSpeciesKey } from "@/domain/growth/species-catalog";
import {
  computeEcologyModifiersForBed,
  NEUTRAL_MODIFIERS as NEUTRAL_ECOLOGY_MODIFIERS,
  type EcologyCell,
  type EcologyModifiers,
} from "@/domain/ecology/ecology-service";
import { InvalidProjectionInputError } from "./errors";
import { applyConditionModifiers, combineModifiers, NEUTRAL_MODIFIERS, type ConditionModifiers } from "./condition-modifiers";
import { irrigationDeliveryMm } from "@/domain/soil/water-bucket-service";

// Same cap rationale as the real catch-up's MAX_CATCH_UP_DAYS (architecture
// doc's §14/§15): bound request latency and how much a single preview can
// ask the server to compute.
const MAX_PROJECTION_DAYS = 60;

const FRESH_BIOLOGY: BiologyState = {
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

// Mirrors FRESH_BIOLOGY for the environment side — a just-planted cell may
// not have a real CellEnvironmentState yet either, so the preview needs its
// own fresh-state fallback (same 0.6 defaults the schema itself uses).
const FRESH_ENVIRONMENT: DailyEnvironmentState = {
  soilMoistureFraction: 0.5,
  soilTempC: 15,
  nitrogenPoolFraction: 0.6,
  phosphorusPoolFraction: 0.6,
  potassiumPoolFraction: 0.6,
  calciumPoolFraction: 0.6,
  micronutrientIndexFraction: 0.6,
  residueOrganicMatterPool: 0,
  mulchDepthMm: 0,
  daysNearSaturation: 0,
  weedPressureFraction: 0,
};

export interface ProjectionOverrideInput {
  bedIds: string[];
  lightMultiplier?: number;
  rainMultiplier?: number;
}

export interface ProjectionDayPoint {
  dayIndex: number;
  date: string;
  soilMoistureFraction: number;
  biology: BiologyState;
}

export interface PlantingProjection {
  cellPlantingId: string;
  bedId: string;
  column: number;
  row: number;
  startingBiology: BiologyState;
  days: ProjectionDayPoint[];
}

export interface WhatIfProjectionInput {
  bedIds: string[];
  projectionDays: number;
  overrides: ProjectionOverrideInput[];
}

function startOfUtcDay(date: Date): Date {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}
function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function modifiersForBed(bedId: string, overrides: readonly ProjectionOverrideInput[]): ConditionModifiers {
  return overrides
    .filter((override) => override.bedIds.includes(bedId))
    .reduce(
      (combined, override) =>
        combineModifiers(combined, {
          lightMultiplier: override.lightMultiplier ?? 1,
          rainMultiplier: override.rainMultiplier ?? 1,
        }),
      NEUTRAL_MODIFIERS,
    );
}

export async function runWhatIfProjection(
  prisma: PrismaClient,
  input: WhatIfProjectionInput,
): Promise<PlantingProjection[]> {
  if (input.bedIds.length === 0) {
    throw new InvalidProjectionInputError("Select at least one bed to preview.");
  }
  if (!Number.isFinite(input.projectionDays) || input.projectionDays < 1) {
    throw new InvalidProjectionInputError("projectionDays must be at least 1.");
  }
  const projectionDays = Math.min(Math.floor(input.projectionDays), MAX_PROJECTION_DAYS);

  const location = await getGardenLocation(prisma);
  const plantings = await prisma.cellPlanting.findMany({
    where: { removedAt: null, cell: { bedId: { in: input.bedIds } } },
    include: {
      biologyState: true,
      plant: { include: { speciesProfile: true } },
      cell: { include: { environmentState: true, bed: { include: { soilProfile: true } } } },
    },
  });

  // Same ecology-modifiers-once-per-bed treatment as catch-up-service.ts,
  // so a what-if preview reflects companion effects too (§19: the preview
  // must diverge from reality only in the hypothetical override, never in
  // which subsystems it runs).
  const ecologyCellsByBed = new Map<string, EcologyCell[]>();
  for (const planting of plantings) {
    const bedId = planting.cell.bedId;
    const speciesKey = planting.plant.speciesProfile?.key ?? guessSpeciesKey(planting.plant.commonName);
    const cells = ecologyCellsByBed.get(bedId) ?? [];
    const existingCell = cells.find((cell) => cell.cellId === planting.cellId);
    if (existingCell) {
      (existingCell.speciesKeys as string[]).push(speciesKey);
    } else {
      cells.push({ cellId: planting.cellId, column: planting.cell.column, row: planting.cell.row, speciesKeys: [speciesKey] });
    }
    ecologyCellsByBed.set(bedId, cells);
  }
  const ecologyModifiersByBed = new Map<string, Map<string, EcologyModifiers>>();
  for (const [bedId, cells] of ecologyCellsByBed) {
    ecologyModifiersByBed.set(bedId, computeEcologyModifiersForBed(cells));
  }

  // A what-if preview isn't given any control over irrigation (only
  // lightMultiplier/rainMultiplier exist on ProjectionOverrideInput), so it
  // reflects reality neutrally here: the automatic daily cycle(s) already
  // configured on the bed's IrrigationSystem are assumed to keep running on
  // schedule for every projected day, same "diverge only in the override"
  // rule this file's own header comment states. Resolved once per bed, same
  // treatment as ecologyModifiersByBed above.
  const irrigationSystems = await prisma.irrigationSystem.findMany({
    where: { beds: { some: { id: { in: input.bedIds } } } },
    include: { beds: { select: { id: true } } },
  });
  const dailyIrrigationMmByBed = new Map<string, number>();
  for (const system of irrigationSystems) {
    const mmPerDay = irrigationDeliveryMm(system.durationMinutes) * system.dailyStartTimes.length;
    for (const bed of system.beds) {
      dailyIrrigationMmByBed.set(bed.id, (dailyIrrigationMmByBed.get(bed.id) ?? 0) + mmPerDay);
    }
  }

  const results: PlantingProjection[] = [];

  for (const planting of plantings) {
    const species: SpeciesGrowthParams =
      planting.plant.speciesProfile ?? (await getFallbackSpeciesProfile(prisma));
    const soilProfile = planting.cell.bed.soilProfile ?? (await getOrCreateSoilProfile(prisma, planting.cell.bedId));
    const modifiers = modifiersForBed(planting.cell.bedId, input.overrides);
    const ecologyModifiers =
      ecologyModifiersByBed.get(planting.cell.bedId)?.get(planting.cellId) ?? NEUTRAL_ECOLOGY_MODIFIERS;
    const dailyIrrigationMm = dailyIrrigationMmByBed.get(planting.cell.bedId) ?? 0;

    // Starts from the planting's CURRENT real state, falling back to a
    // fresh-planting baseline if it hasn't had its first real catch-up yet
    // — the preview must still work for a just-planted cell.
    let biology: BiologyState = planting.biologyState ?? FRESH_BIOLOGY;
    const startingBiology = biology;
    let environment: DailyEnvironmentState = planting.cell.environmentState ?? FRESH_ENVIRONMENT;
    let cursor = startOfUtcDay(new Date());
    const plantedAt = planting.plantedAt;

    const days: ProjectionDayPoint[] = [];
    for (let dayIndex = 0; dayIndex < projectionDays; dayIndex += 1) {
      cursor = addUtcDays(cursor, 1);
      // Future weather is fetched/cached exactly as the real catch-up
      // would (and is safe to cache: it doesn't depend on the hypothetical
      // override, only the planting's RESPONSE to it does below) — the
      // preview only diverges from reality in that response, not in what
      // the underlying weather record is.
      const rawWeather = await getOrGenerateWeatherDay(prisma, location, cursor, "PROCEDURAL");
      const effectiveWeather = applyConditionModifiers(rawWeather, modifiers);
      const plantingAgeDays = Math.max(0, (cursor.getTime() - plantedAt.getTime()) / (24 * 60 * 60 * 1000));

      const dayResult = runOneDayForPlanting({
        species,
        biology,
        weather: effectiveWeather,
        soilProfile: {
          fieldCapacityFraction: soilProfile.fieldCapacityFraction,
          wiltingPointFraction: soilProfile.wiltingPointFraction,
        },
        environment,
        baselineLight: planting.cell.baselineLight,
        plantingAgeDays,
        ecologyModifiers,
        // A what-if preview is about conditions (light/rain), not pathology
        // — it deliberately does NOT simulate new infections or pest
        // population dynamics (both are real, persisted, path-dependent
        // state per NC-SPRIG-GROWTH2-NO-OVERWRITE-JOURNAL's own spirit), so
        // every projected day holds disease/pest pressure at neutral.
        activeDiseaseEffect: NEUTRAL_DISEASE_EFFECT,
        pestPressureDialValue: 0,
        pestDamage: NEUTRAL_PEST_DAMAGE,
        irrigationMm: dailyIrrigationMm,
      });
      biology = dayResult.biology;
      environment = dayResult.environment;

      days.push({ dayIndex, date: cursor.toISOString().slice(0, 10), soilMoistureFraction: environment.soilMoistureFraction, biology });
    }

    results.push({
      cellPlantingId: planting.id,
      bedId: planting.cell.bedId,
      column: planting.cell.column,
      row: planting.cell.row,
      startingBiology,
      days,
    });
  }

  return results;
}
