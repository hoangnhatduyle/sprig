// The only place the growth engine actually runs: advances every active
// (non-removed) CellPlanting's PlantingBiologyState — and its cell's
// CellEnvironmentState — from wherever it last left off up to the current
// derived sim time, one simulated day at a time. Called opportunistically
// whenever current garden state is read (see actions.ts), mirroring
// irrigation's reapStaleRuns/maybeTriggerDailyCycle precedent for a
// no-background-worker architecture. See the architecture doc's §2/§14.

import type { CellStatus, PrismaClient, SpeciesProfile } from "@prisma/client";
import { germinate, grow } from "@/domain/grid/grid-cell-service";
import { getGardenLocation } from "@/domain/lighting/garden-location";
import { getBedEffectiveConditions } from "@/domain/conditions/bed-effective-conditions";
import { applyConditionModifiers } from "@/domain/conditions/condition-modifiers";
import { getOrCreateSoilProfile } from "@/domain/soil/soil-profile-service";
import { computeEcologyModifiersForBed, NEUTRAL_MODIFIERS, type EcologyCell, type EcologyModifiers } from "@/domain/ecology/ecology-service";
import { dominantStressLabel, overwaterDialFromDaysNearSaturation } from "./stress-service";
import type { WeatherSourcePreference } from "@/domain/weather/weather-service";
import { getOrGenerateWeatherDay } from "@/domain/weather/weather-service";
import type { GardenLocationCoords } from "@/domain/lighting/sun-times";
import {
  ensureSpeciesCatalogSeeded,
  getFallbackSpeciesProfile,
  guessSpeciesKey,
} from "./species-catalog";
import type { BiologyState, PhenologyStage, SpeciesGrowthParams } from "./growth-engine-service";
import { runOneDayForPlanting, type DailyEnvironmentState } from "./daily-step-orchestrator";
import { getCurrentSimTime } from "./sim-clock-service";
import { getDiseaseDefinition } from "@/domain/disease/disease-catalog";
import {
  conditionMatchForDisease,
  effectForActiveInfection,
  neighborInfectionPressureFromCounts,
  NEUTRAL_DISEASE_EFFECT,
  stepDiseaseSeverity,
  tryInfect,
  type DiseaseInstanceEffect,
} from "@/domain/disease/disease-service";
import { PEST_DEFINITIONS } from "@/domain/pests/pest-catalog";
import { PREDATOR_DEFINITIONS } from "@/domain/pests/predator-catalog";
import {
  computeDamageForPlanting,
  pestPressureDialValue,
  stepPestPopulations,
  stepPredatorPopulations,
  type PestPopulationState,
  type PredatorPopulationState,
} from "@/domain/pests/pest-service";

const MS_PER_DAY = 86_400_000;
// A brand-new infection starts at a small nonzero severity (roughly one
// day's worth of growth at a typical severityGrowthRate) rather than 0 — a
// planting that just got infected should already show SOME signal, not
// silently carry an invisible 0-severity infection for a day.
const INITIAL_INFECTION_SEVERITY = 0.08;

function monthIndex1to12(date: Date): number {
  return date.getUTCMonth() + 1;
}

// Companion-planting proximity only makes sense within one bed
// (ecology-service.ts's adjacency check compares column/row, which are only
// meaningful bed-locally) — grouped once up front so
// computeEcologyModifiersForBed runs once per bed, not once per planting.
function buildEcologyCellsByBed(
  plantings: ReadonlyArray<{
    cellId: string;
    cell: { bedId: string; column: number; row: number };
    plant: { commonName: string; speciesProfile: { key: string } | null };
  }>,
): Map<string, EcologyCell[]> {
  const cellsByBed = new Map<string, Map<string, { column: number; row: number; speciesKeys: string[] }>>();
  for (const planting of plantings) {
    const bedId = planting.cell.bedId;
    const speciesKey = planting.plant.speciesProfile?.key ?? guessSpeciesKey(planting.plant.commonName);
    let bedCells = cellsByBed.get(bedId);
    if (!bedCells) {
      bedCells = new Map();
      cellsByBed.set(bedId, bedCells);
    }
    let cell = bedCells.get(planting.cellId);
    if (!cell) {
      cell = { column: planting.cell.column, row: planting.cell.row, speciesKeys: [] };
      bedCells.set(planting.cellId, cell);
    }
    cell.speciesKeys.push(speciesKey);
  }
  const result = new Map<string, EcologyCell[]>();
  for (const [bedId, bedCells] of cellsByBed) {
    result.set(
      bedId,
      Array.from(bedCells.entries()).map(([cellId, cell]) => ({ cellId, ...cell })),
    );
  }
  return result;
}

// A cap on how many simulated days a single call will silently fast-forward
// through — bounds both request latency and how much state changes in one
// shot when a garden is reopened after a long accelerated-time absence (the
// architecture doc's §15 balancing principle: never freeze the UI, never
// mutate an unbounded amount of state with no explanation).
const MAX_CATCH_UP_DAYS = 60;

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

// Weather generation used to happen only as a side effect of the
// per-planting daily-step loop further down (its `while (cursor < through)`
// loop calls getOrGenerateWeatherDay) — so a garden with zero active
// plantings never generated a WeatherDay row no matter how many times
// "Advance now" was clicked, since that loop body never ran. Weather is a
// whole-garden, not a per-planting, concept, so it's caught up here
// unconditionally instead. getOrGenerateWeatherDay is idempotent (an
// existing row for a date is returned as-is, see weather-service.ts), so the
// per-planting loop calling it again for the same days afterward is a
// harmless no-op read, not duplicate generation.
async function catchUpWeatherDays(
  prisma: PrismaClient,
  location: GardenLocationCoords,
  through: Date,
  weatherSource: WeatherSourcePreference,
): Promise<void> {
  const latest = await prisma.weatherDay.findFirst({ orderBy: { date: "desc" } });
  // On the very first-ever call there's no prior day to backfill from —
  // generate just today's row rather than guessing how far back to go.
  let cursor = latest ? addUtcDays(latest.date, 1) : through;
  let daysStepped = 0;
  while (cursor <= through && daysStepped < MAX_CATCH_UP_DAYS) {
    await getOrGenerateWeatherDay(prisma, location, cursor, weatherSource);
    cursor = addUtcDays(cursor, 1);
    daysStepped += 1;
  }
}

export interface CatchUpSummary {
  plantingsProcessed: number;
  daysProcessed: number;
  cappedAt: number | null;
}

// The coarse SPEC-GRID-001 CellStatus a phenology stage projects onto — see
// the architecture doc's §6/§13: CellStatus is kept as a derived,
// backward-compatible view rather than replaced. There is no CellStatus for
// DEAD; a dead planting still reads as GROWING at this coarse level (its
// biology data carries the wilted/dead signal for the visuals instead).
function deriveCellStatus(phenologyStage: PhenologyStage, accumulatedGdd: number, species: SpeciesGrowthParams): CellStatus {
  if (phenologyStage === "GERMINATING") {
    return accumulatedGdd >= species.gddToGerminate ? "GERMINATED" : "PLANTED";
  }
  return "GROWING";
}

// Only ever moves a cell FORWARD through PLANTED -> GERMINATED -> GROWING,
// and only while it's still in one of those three lifecycle statuses —
// HARVESTED/REMOVED are terminal/manual states the growth engine must never
// silently overwrite (mirrors NC-SPRIG-NO-SILENT-PLANT-CHANGE's spirit).
// Reuses grid-cell-service.ts's own tested germinate/grow transitions
// (including their journal-event writes) instead of re-implementing status
// changes here, and always hops through GERMINATED on the way to GROWING —
// a catch-up spanning many days can cross both thresholds in one call, but
// the FSM still requires the intermediate step.
async function syncCellStatusFromPhenology(
  prisma: PrismaClient,
  cell: { bedId: string; column: number; row: number; status: CellStatus },
  phenologyStage: PhenologyStage,
  accumulatedGdd: number,
  species: SpeciesGrowthParams,
): Promise<void> {
  if (cell.status !== "PLANTED" && cell.status !== "GERMINATED" && cell.status !== "GROWING") {
    return;
  }
  const target = deriveCellStatus(phenologyStage, accumulatedGdd, species);
  const cellLookup = { bedId: cell.bedId, column: cell.column, row: cell.row };

  if (cell.status === "PLANTED" && (target === "GERMINATED" || target === "GROWING")) {
    await germinate(prisma, cellLookup);
    if (target === "GROWING") {
      await grow(prisma, cellLookup);
    }
    return;
  }
  if (cell.status === "GERMINATED" && target === "GROWING") {
    await grow(prisma, cellLookup);
  }
}

export async function catchUpGrowth(
  prisma: PrismaClient,
  options: { through?: Date; weatherSource?: WeatherSourcePreference } = {},
): Promise<CatchUpSummary> {
  await ensureSpeciesCatalogSeeded(prisma);

  const clock = await getCurrentSimTime(prisma);
  const through = startOfUtcDay(options.through ?? clock.simTime);
  const weatherSource: WeatherSourcePreference = options.weatherSource ?? "PROCEDURAL";
  const location = await getGardenLocation(prisma);
  await catchUpWeatherDays(prisma, location, through, weatherSource);

  const plantings = await prisma.cellPlanting.findMany({
    where: { removedAt: null },
    include: {
      biologyState: true,
      plant: { include: { speciesProfile: true } },
      cell: { include: { environmentState: true, bed: { include: { soilProfile: true } } } },
    },
  });

  const ecologyCellsByBed = buildEcologyCellsByBed(plantings);
  const ecologyModifiersByBed = new Map<string, Map<string, EcologyModifiers>>();
  for (const [bedId, cells] of ecologyCellsByBed) {
    ecologyModifiersByBed.set(bedId, computeEcologyModifiersForBed(cells));
  }

  // Resolved once per planting up front (not once per planting per call, as
  // the pre-Phase-3 loop below used to do) — both this file's own new
  // pest-context pass and the main per-planting loop need each planting's
  // full SpeciesProfile (growthHabit, diseaseResistanceTrait), not just the
  // narrower SpeciesGrowthParams shape the growth engine itself needs.
  const fallbackSpecies = await getFallbackSpeciesProfile(prisma);
  const speciesByPlantingId = new Map<string, SpeciesProfile>();
  for (const planting of plantings) {
    speciesByPlantingId.set(planting.id, planting.plant.speciesProfile ?? fallbackSpecies);
  }

  const bedIds = Array.from(new Set(plantings.map((planting) => planting.cell.bedId)));

  // Pest/predator population catch-up (architecture doc §10): bed-scoped,
  // stepped ONCE per bed for the whole catch-up window here, ahead of the
  // per-planting loop — the same "resolved once per whole window, not
  // re-resolved per simulated day" treatment already established for
  // conditions/ecology modifiers below. Host biomass (and therefore
  // carrying capacity) is taken from each planting's CURRENT biology
  // snapshot, held constant across the window; real day-by-day feedback
  // between plant growth and pest population still happens ACROSS repeated
  // catch-up calls (the normal usage pattern), just not lockstepped within
  // one call.
  const pestPopulationRows = await prisma.pestPopulation.findMany({ where: { bedId: { in: bedIds } } });
  const predatorPopulationRows = await prisma.predatorPopulation.findMany({ where: { bedId: { in: bedIds } } });
  const finalPestPopulationByBed = new Map<string, PestPopulationState>();

  for (const bedId of bedIds) {
    const bedPlantings = plantings.filter((planting) => planting.cell.bedId === bedId);
    const hostBiomassByPest = new Map<string, number>();
    for (const pest of PEST_DEFINITIONS) {
      let total = 0;
      for (const planting of bedPlantings) {
        const profile = speciesByPlantingId.get(planting.id)!;
        if (!pest.hostGrowthHabits.includes(profile.growthHabit)) continue;
        total += (planting.biologyState?.leafFraction ?? 0) + (planting.biologyState?.stemFraction ?? 0);
      }
      hostBiomassByPest.set(pest.key, total);
    }
    const bedEcologyModifiers = ecologyModifiersByBed.get(bedId);
    const insectaryAttraction = bedEcologyModifiers && bedEcologyModifiers.size > 0
      ? Array.from(bedEcologyModifiers.values()).reduce((sum, modifiers) => sum + modifiers.predatorAttraction, 0) /
        bedEcologyModifiers.size
      : 0;

    const pestRowByKey = new Map(pestPopulationRows.filter((row) => row.bedId === bedId).map((row) => [row.pestKey, row]));
    const predatorRowByKey = new Map(
      predatorPopulationRows.filter((row) => row.bedId === bedId).map((row) => [row.predatorKey, row]),
    );

    let populations: PestPopulationState = {};
    let cursor: Date | null = null;
    for (const pest of PEST_DEFINITIONS) {
      const row = pestRowByKey.get(pest.key);
      populations[pest.key] = row?.population ?? 0;
      const rowThrough = row ? startOfUtcDay(row.updatedThroughDate) : through;
      if (cursor === null || rowThrough < cursor) cursor = rowThrough;
    }
    let predatorPopulations: PredatorPopulationState = {};
    for (const predator of PREDATOR_DEFINITIONS) {
      predatorPopulations[predator.key] = predatorRowByKey.get(predator.key)?.population ?? 0;
    }
    let bedCursor = cursor ?? through;

    let bedDaysStepped = 0;
    while (bedCursor < through && bedDaysStepped < MAX_CATCH_UP_DAYS) {
      bedCursor = addUtcDays(bedCursor, 1);
      const monthIndex = monthIndex1to12(bedCursor);
      const nextPopulations: PestPopulationState = {};
      for (const pest of PEST_DEFINITIONS) {
        nextPopulations[pest.key] = stepPestPopulations([pest], {
          populations,
          predatorPopulations,
          hostBiomass: hostBiomassByPest.get(pest.key) ?? 0,
          monthIndex1to12: monthIndex,
        })[pest.key];
      }
      const nextPredatorPopulations = stepPredatorPopulations(PREDATOR_DEFINITIONS, {
        predatorPopulations,
        pestPopulations: populations,
        insectaryAttraction,
      });
      populations = nextPopulations;
      predatorPopulations = nextPredatorPopulations;
      bedDaysStepped += 1;
    }

    finalPestPopulationByBed.set(bedId, populations);

    for (const pest of PEST_DEFINITIONS) {
      await prisma.pestPopulation.upsert({
        where: { bedId_pestKey: { bedId, pestKey: pest.key } },
        update: { population: populations[pest.key], updatedThroughDate: bedCursor },
        create: { bedId, pestKey: pest.key, population: populations[pest.key], updatedThroughDate: bedCursor },
      });
    }
    for (const predator of PREDATOR_DEFINITIONS) {
      await prisma.predatorPopulation.upsert({
        where: { bedId_predatorKey: { bedId, predatorKey: predator.key } },
        update: { population: predatorPopulations[predator.key], updatedThroughDate: bedCursor },
        create: {
          bedId,
          predatorKey: predator.key,
          population: predatorPopulations[predator.key],
          updatedThroughDate: bedCursor,
        },
      });
    }
  }

  // Disease neighbor-infection-pressure snapshot (architecture doc §9/§11):
  // also resolved ONCE per bed before the per-planting loop, from
  // whatever's currently active — a planting infected partway through this
  // same catch-up call doesn't retroactively raise its bed-mates' pressure
  // until the NEXT catch-up call, the same simplification pest/predator
  // populations above already accept.
  const activeInfections = await prisma.diseaseInfection.findMany({
    where: { cellPlantingId: { in: plantings.map((planting) => planting.id) }, resolvedAt: null },
  });
  const activeInfectionByPlantingId = new Map(activeInfections.map((infection) => [infection.cellPlantingId, infection]));
  const infectedCountByBed = new Map<string, number>();
  for (const planting of plantings) {
    if (!activeInfectionByPlantingId.has(planting.id)) continue;
    const bedId = planting.cell.bedId;
    infectedCountByBed.set(bedId, (infectedCountByBed.get(bedId) ?? 0) + 1);
  }
  const bedPlantingCount = new Map<string, number>();
  for (const planting of plantings) {
    const bedId = planting.cell.bedId;
    bedPlantingCount.set(bedId, (bedPlantingCount.get(bedId) ?? 0) + 1);
  }

  let plantingsProcessed = 0;
  let daysProcessed = 0;
  let cappedAt: number | null = null;

  for (const planting of plantings) {
    if (cappedAt !== null) break;

    const speciesProfile = speciesByPlantingId.get(planting.id)!;
    const species: SpeciesGrowthParams = speciesProfile;
    const bedId = planting.cell.bedId;
    const bedPestPopulations = finalPestPopulationByBed.get(bedId) ?? {};
    const isThisPlantingInfected = activeInfectionByPlantingId.has(planting.id);
    const neighborInfectionPressure = neighborInfectionPressureFromCounts(
      (infectedCountByBed.get(bedId) ?? 0) - (isThisPlantingInfected ? 1 : 0),
      (bedPlantingCount.get(bedId) ?? 1) - 1,
    );
    const existingInfectionRow = activeInfectionByPlantingId.get(planting.id) ?? null;
    let activeInfection: { diseaseKey: string; severity: number } | null = existingInfectionRow
      ? { diseaseKey: existingInfectionRow.diseaseKey, severity: existingInfectionRow.severity }
      : null;
    let currentInfectionRowId: string | null = existingInfectionRow?.id ?? null;

    let biologyRow = planting.biologyState;
    if (!biologyRow) {
      biologyRow = await prisma.plantingBiologyState.create({
        data: { cellPlantingId: planting.id, updatedThroughDate: startOfUtcDay(planting.plantedAt) },
      });
    }
    let envRow = planting.cell.environmentState;
    if (!envRow) {
      envRow = await prisma.cellEnvironmentState.create({
        data: { cellId: planting.cellId, updatedThroughDate: startOfUtcDay(planting.plantedAt) },
      });
    }

    // Sleeping plantings (§14): a DEAD planting never changes again via the
    // daily step — skip simulating it entirely rather than paying for
    // (weather lookup + water bucket + growth step) x days for an entity
    // that provably can't change.
    if (biologyRow.phenologyStage === "DEAD") {
      if (biologyRow.updatedThroughDate < through) {
        await prisma.plantingBiologyState.update({
          where: { id: biologyRow.id },
          data: { updatedThroughDate: through },
        });
      }
      continue;
    }

    const soilProfile = planting.cell.bed.soilProfile ?? (await getOrCreateSoilProfile(prisma, planting.cell.bedId));
    // Real, persistent equipment (shade cloth / grow light / rain cover,
    // src/domain/conditions) resolved once per planting, not once per
    // simulated day — see bed-effective-conditions.ts on why "currently
    // active" is read as a stand-in for the whole catch-up window. Companion
    // ecology modifiers get the same "resolved once for the whole window"
    // treatment for the same reason.
    const conditions = await getBedEffectiveConditions(prisma, planting.cell.bedId);
    const ecologyModifiers =
      ecologyModifiersByBed.get(planting.cell.bedId)?.get(planting.cellId) ?? NEUTRAL_MODIFIERS;

    let biology: BiologyState = biologyRow;
    let environment: DailyEnvironmentState = envRow;
    let cursor = startOfUtcDay(biologyRow.updatedThroughDate);
    const startingCellStatus = planting.cell.status;
    let lastDominantStressDial: string | null = biologyRow.dominantStressDial;

    if (cursor >= through) {
      continue;
    }
    plantingsProcessed += 1;

    while (cursor < through) {
      cursor = addUtcDays(cursor, 1);
      const rawWeather = await getOrGenerateWeatherDay(prisma, location, cursor, weatherSource);
      // Installed equipment adjusts the weather this cell actually
      // experiences before anything downstream sees it — one integration
      // point (src/domain/conditions/condition-modifiers.ts), not scattered
      // special cases in the water bucket or growth step.
      const weather = applyConditionModifiers(rawWeather, conditions);
      const plantingAgeDays = Math.max(0, (cursor.getTime() - planting.plantedAt.getTime()) / MS_PER_DAY);

      // Disease progression (architecture doc §9) reads the PREVIOUS day's
      // ending soil-moisture/overwater state (environment hasn't been
      // overwritten by today's water-bucket step yet) — avoids a circular
      // dependency on today's own not-yet-computed water-bucket output.
      // Overwatering conditions persist across multiple days by
      // construction (stress-service.ts's own grace/decay window), so a
      // one-day lag here is negligible in practice.
      const overwaterDial = overwaterDialFromDaysNearSaturation(environment.daysNearSaturation);
      const diseaseConditions = {
        weather,
        soilMoistureFraction: environment.soilMoistureFraction,
        overwaterDial,
      };
      let activeDiseaseEffect: DiseaseInstanceEffect = NEUTRAL_DISEASE_EFFECT;
      if (activeInfection) {
        const disease = getDiseaseDefinition(activeInfection.diseaseKey);
        if (disease) {
          const conditionMatchValue = conditionMatchForDisease(disease, diseaseConditions);
          const stepResult = stepDiseaseSeverity(activeInfection.severity, disease, conditionMatchValue);
          if (stepResult.resolved) {
            if (currentInfectionRowId) {
              await prisma.diseaseInfection.update({
                where: { id: currentInfectionRowId },
                data: { severity: 0, resolvedAt: cursor, updatedThroughDate: cursor },
              });
              currentInfectionRowId = null;
            }
            activeInfection = null;
          } else {
            activeInfection = { diseaseKey: disease.key, severity: stepResult.severity };
            activeDiseaseEffect = effectForActiveInfection(disease, stepResult.severity);
          }
        } else {
          activeInfection = null;
        }
      } else {
        const newDisease = tryInfect({
          speciesKey: speciesProfile.key,
          resistanceTrait: speciesProfile.diseaseResistanceTrait,
          neighborInfectionPressure,
          conditions: diseaseConditions,
          cellPlantingId: planting.id,
          date: cursor,
        });
        if (newDisease) {
          const created = await prisma.diseaseInfection.create({
            data: {
              cellPlantingId: planting.id,
              diseaseKey: newDisease.key,
              severity: INITIAL_INFECTION_SEVERITY,
              startedAt: cursor,
              updatedThroughDate: cursor,
            },
          });
          currentInfectionRowId = created.id;
          activeInfection = { diseaseKey: newDisease.key, severity: INITIAL_INFECTION_SEVERITY };
          activeDiseaseEffect = effectForActiveInfection(newDisease, INITIAL_INFECTION_SEVERITY);
        }
      }

      const isSeedlingStage = biology.phenologyStage === "GERMINATING" || biology.phenologyStage === "VEGETATIVE";
      const pestDamage = computeDamageForPlanting(speciesProfile.growthHabit, bedPestPopulations, isSeedlingStage);
      const pressureDial = pestPressureDialValue(speciesProfile.growthHabit, bedPestPopulations);

      const dayResult = runOneDayForPlanting({
        species,
        biology,
        weather,
        soilProfile: {
          fieldCapacityFraction: soilProfile.fieldCapacityFraction,
          wiltingPointFraction: soilProfile.wiltingPointFraction,
        },
        environment,
        baselineLight: planting.cell.baselineLight,
        plantingAgeDays,
        ecologyModifiers,
        activeDiseaseEffect,
        pestPressureDialValue: pressureDial,
        pestDamage,
      });
      biology = dayResult.biology;
      environment = dayResult.environment;
      lastDominantStressDial = dominantStressLabel(dayResult.stress);

      daysProcessed += 1;
      if (daysProcessed >= MAX_CATCH_UP_DAYS) {
        cappedAt = daysProcessed;
        break;
      }
    }

    // One final write reflecting wherever the infection landed after the
    // whole window — the per-day loop above only writes DB rows on a
    // create/resolve TRANSITION, not every simulated day.
    if (currentInfectionRowId && activeInfection) {
      await prisma.diseaseInfection.update({
        where: { id: currentInfectionRowId },
        data: { severity: activeInfection.severity, updatedThroughDate: cursor },
      });
    }

    await prisma.$transaction([
      prisma.plantingBiologyState.update({
        where: { id: biologyRow.id },
        data: { ...biology, dominantStressDial: lastDominantStressDial, updatedThroughDate: cursor },
      }),
      prisma.cellEnvironmentState.update({
        where: { id: envRow.id },
        data: { ...environment, updatedThroughDate: cursor },
      }),
    ]);

    await syncCellStatusFromPhenology(
      prisma,
      {
        bedId: planting.cell.bedId,
        column: planting.cell.column,
        row: planting.cell.row,
        status: startingCellStatus,
      },
      biology.phenologyStage,
      biology.accumulatedGdd,
      species,
    );
  }

  return { plantingsProcessed, daysProcessed, cappedAt };
}
