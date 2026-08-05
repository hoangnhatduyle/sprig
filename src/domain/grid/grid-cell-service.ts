import type { Bed, PrismaClient, RainBarrelStatus } from "@prisma/client";
import {
  DuplicateCompanionPlantError,
  GeometryValidationError,
  HarvestedCellError,
  JournalIntegrityViolationError,
  NoActivePlantingError,
} from "./errors";
import {
  type CellStatus,
  type PlantingEvent,
  isTransitionAllowed,
  nextStatus,
} from "./planting-lifecycle";
import { InventoryValidationError } from "@/domain/plant-catalog/inventory-service";
import { getCurrentSimTime } from "@/domain/growth/sim-clock-service";
import { getGardenLocation } from "@/domain/lighting/garden-location";
import { computePhase, computeSunPosition, computeSunTimes } from "@/domain/lighting/sun-times";
import type { DayNightPhase } from "@/domain/lighting/day-night-lifecycle";
import { getForecastView, getWeatherDayView, type WeatherDayView } from "@/domain/weather/weather-service";
import { estimateEvapotranspirationDisplayMm } from "@/domain/soil/water-bucket-service";
import { companionEffectsForSpecies, type CompanionEffectKind } from "@/domain/ecology/companion-catalog";
import { getFallbackSpeciesProfile, guessSpeciesKey } from "@/domain/growth/species-catalog";

const GRID_COLS = 4;
const GRID_ROWS = 8;

interface SeedBedInput {
  name: string;
  compassPosition: "SOUTH" | "NORTH";
}

// Structural west-to-east baseline gradient documented in SPEC-GRID-001:
// row 1 (west) = partial shade, row totalRows (east) = full sun. Split at
// the midpoint until a finer-grained gradient is required by a spec/test.
function baselineLightFor(row: number, totalRows: number): "PARTIAL_SHADE" | "FULL_SUN" {
  return row <= Math.ceil(totalRows / 2) ? "PARTIAL_SHADE" : "FULL_SUN";
}

export async function seedBed(prisma: PrismaClient, input: SeedBedInput): Promise<Bed> {
  // bed.create and gridCell.createMany must succeed together — a failure
  // partway through would otherwise leave a Bed row declaring a 4x8 grid
  // with zero actual GridCell rows, which the AC-1 read model relies on
  // being a complete rectangle.
  return prisma.$transaction(async (tx) => {
    const bed = await tx.bed.create({
      data: {
        name: input.name,
        compassPosition: input.compassPosition,
        gridCols: GRID_COLS,
        gridRows: GRID_ROWS,
      },
    });

    const cells = [];
    for (let column = 1; column <= GRID_COLS; column += 1) {
      for (let row = 1; row <= GRID_ROWS; row += 1) {
        cells.push({
          bedId: bed.id,
          column,
          row,
          baselineLight: baselineLightFor(row, GRID_ROWS),
        });
      }
    }
    await tx.gridCell.createMany({ data: cells });

    return bed;
  });
}

interface AssignPlantInput {
  bedId: string;
  column: number;
  row: number;
  plantId: string;
}

// Replaces the cell's single active plant assignment and appends a dated
// journal event (NC-SPRIG-NO-SILENT-PLANT-CHANGE, NC-SPRIG-NO-OVERWRITE-JOURNAL).
// Assigning a plant always starts a fresh planting cycle — status becomes
// PLANTED and the event is typed PLANTED, even if the cell was mid-cycle
// (e.g. GROWING with a different plant): the old occupant is being pulled
// and a new one put in, which *is* a new cycle, not a continuation of the
// old one. Use addCompanionPlant to add a second simultaneous plant instead
// of replacing the existing one.
export async function assignPlant(prisma: PrismaClient, input: AssignPlantInput): Promise<void> {
  // All four writes must succeed or none must: a mid-sequence failure (e.g. a
  // plantId that no longer exists) must never leave the cell with its prior
  // planting soft-removed but no replacement and no journal event — that is
  // exactly the silent change NC-SPRIG-NO-SILENT-PLANT-CHANGE prohibits.
  //
  // Note: this existence check is done explicitly, ahead of the write,
  // rather than relying solely on Postgres's own FK constraint to reject a
  // dangling plantId — that would surface as an opaque constraint-violation
  // error mid-transaction instead of the clear findUniqueOrThrow failure
  // below, before any of the four writes in this transaction have run.
  await prisma.$transaction(async (tx) => {
    await tx.plant.findUniqueOrThrow({ where: { id: input.plantId } });

    const cell = await tx.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: input.bedId, column: input.column, row: input.row } },
    });

    const currentStatus = cell.status as CellStatus;

    if (currentStatus === "HARVESTED") {
      throw new HarvestedCellError(
        "Cannot reassign a plant to a HARVESTED cell directly; clear/remove it first (a harvested plant cannot un-harvest).",
      );
    }

    // EMPTY/REMOVED -> PLANTED goes through the state machine; a plant
    // replacing another mid-cycle (PLANTED/GERMINATED/GROWING) isn't a
    // state-machine transition, but it always resolves to PLANTED — a new
    // plant means a new cycle.
    const newStatus: CellStatus = isTransitionAllowed(currentStatus, "assign_plant")
      ? nextStatus(currentStatus, "assign_plant")
      : "PLANTED";

    // Capture active plantings BEFORE evicting them — every one being
    // evicted (the primary plant, and any companions) must get its own
    // dated journal event. Silently soft-removing a companion with no event
    // is exactly the change NC-SPRIG-NO-SILENT-PLANT-CHANGE prohibits.
    const evictedPlantings = await tx.cellPlanting.findMany({
      where: { cellId: cell.id, removedAt: null },
    });

    await tx.cellPlanting.updateMany({
      where: { cellId: cell.id, removedAt: null },
      data: { removedAt: new Date() },
    });

    if (evictedPlantings.length > 0) {
      await tx.gridCellEvent.createMany({
        data: evictedPlantings.map((planting) => ({
          cellId: cell.id,
          eventType: "REMOVED" as CellStatus,
          plantId: planting.plantId,
        })),
      });
    }

    await tx.cellPlanting.create({
      data: { cellId: cell.id, plantId: input.plantId },
    });

    await tx.gridCellEvent.create({
      data: {
        cellId: cell.id,
        eventType: newStatus,
        plantId: input.plantId,
      },
    });

    await tx.gridCell.update({
      where: { id: cell.id },
      data: { status: newStatus, plantedAt: new Date() },
    });
  });
}

interface AddCompanionPlantInput {
  bedId: string;
  column: number;
  row: number;
  plantId: string;
}

// Adds a second (or further) simultaneously-active plant to a cell that
// already has a primary planting — the companion-planting capability
// SPEC-GRID-001 calls out as the reason plant assignments are a list, not a
// single field. Does not touch the cell's lifecycle status: companion
// plantings ride along with whatever cycle the primary planting is in.
export async function addCompanionPlant(
  prisma: PrismaClient,
  input: AddCompanionPlantInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.plant.findUniqueOrThrow({ where: { id: input.plantId } });

    const cell = await tx.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: input.bedId, column: input.column, row: input.row } },
    });

    const currentStatus = cell.status as CellStatus;
    if (currentStatus === "EMPTY" || currentStatus === "REMOVED") {
      throw new NoActivePlantingError(
        "Cannot add a companion plant to an empty cell; assign a primary plant first.",
      );
    }
    if (currentStatus === "HARVESTED") {
      throw new HarvestedCellError("Cannot add a companion plant to a HARVESTED cell.");
    }

    const duplicateActive = await tx.cellPlanting.findFirst({
      where: { cellId: cell.id, plantId: input.plantId, removedAt: null },
    });
    if (duplicateActive) {
      throw new DuplicateCompanionPlantError(
        "That plant is already actively assigned to this cell.",
      );
    }

    await tx.cellPlanting.create({
      data: { cellId: cell.id, plantId: input.plantId },
    });

    await tx.gridCellEvent.create({
      data: {
        cellId: cell.id,
        eventType: currentStatus,
        plantId: input.plantId,
        note: "companion planting",
      },
    });
  });
}

interface RemoveCompanionPlantInput {
  bedId: string;
  column: number;
  row: number;
  plantId: string;
}

// Soft-removes exactly one active planting (the companion identified by
// plantId) and journals it — the inverse of addCompanionPlant. Does not
// touch the cell's lifecycle status. Rejects removing the *last* active
// planting through this path; use removeCell/clearCell for that, since
// vacating the cell entirely is a lifecycle transition, not a plant edit.
export async function removeCompanionPlant(
  prisma: PrismaClient,
  input: RemoveCompanionPlantInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const cell = await tx.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: input.bedId, column: input.column, row: input.row } },
    });

    const activePlantings = await tx.cellPlanting.findMany({
      where: { cellId: cell.id, removedAt: null },
    });
    const target = activePlantings.find((p) => p.plantId === input.plantId);
    if (!target) {
      throw new NoActivePlantingError("That plant is not actively assigned to this cell.");
    }
    if (activePlantings.length === 1) {
      throw new NoActivePlantingError(
        "Cannot remove the last active planting via removeCompanionPlant; use removeCell/clearCell to vacate the cell.",
      );
    }

    await tx.cellPlanting.update({
      where: { id: target.id },
      data: { removedAt: new Date() },
    });

    await tx.gridCellEvent.create({
      data: {
        cellId: cell.id,
        eventType: "REMOVED",
        plantId: target.plantId,
        note: "companion planting removed",
      },
    });
  });
}

export interface RemovePlantingInput {
  bedId: string;
  column: number;
  row: number;
  plantId: string;
}

// Single entry point for "remove this specific plant from this cell" — the
// picker UI's Remove button calls this without needing to know which of
// GRID's two removal primitives applies: if plantId is the cell's only
// active planting, removing it vacates the whole cell via the "remove"
// lifecycle transition (removeCell); if other plantings remain, it uses
// removeCompanionPlant so the rest of the cell's plants stay untouched.
export async function removePlanting(
  prisma: PrismaClient,
  input: RemovePlantingInput,
): Promise<void> {
  const cell = await prisma.gridCell.findUniqueOrThrow({
    where: { bedId_column_row: { bedId: input.bedId, column: input.column, row: input.row } },
  });
  const active = await prisma.cellPlanting.findMany({
    where: { cellId: cell.id, removedAt: null },
  });
  if (!active.some((planting) => planting.plantId === input.plantId)) {
    throw new NoActivePlantingError("That plant is not actively assigned to this cell.");
  }
  if (active.length === 1) {
    await removeCell(prisma, input);
    return;
  }
  await removeCompanionPlant(prisma, input);
}

interface CellLookup {
  bedId: string;
  column: number;
  row: number;
}

// Shared implementation behind germinate/grow/harvest/removeCell/clearCell:
// advance a cell's lifecycle status by one event, rejecting any transition
// not declared in the spec's state machine, and always recording a dated
// journal event alongside the status change (NC-SPRIG-NO-SILENT-PLANT-CHANGE).
async function advanceLifecycle(
  prisma: PrismaClient,
  input: CellLookup,
  event: Exclude<PlantingEvent, "assign_plant">,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const cell = await tx.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: input.bedId, column: input.column, row: input.row } },
    });

    const currentStatus = cell.status as CellStatus;
    // Throws LifecycleTransitionError if this event isn't legal from the
    // cell's current status (e.g. germinate from EMPTY, grow from HARVESTED).
    const newStatus = nextStatus(currentStatus, event);

    // Capture every active planting BEFORE vacating (remove/clear) — a cell
    // can hold multiple simultaneous plants (companion planting), and every
    // one of them needs its own dated event for this status change, not just
    // whichever row a single findFirst happens to pick.
    const activePlantings = await tx.cellPlanting.findMany({
      where: { cellId: cell.id, removedAt: null },
    });

    // "remove"/"clear" vacate the cell: any active planting ends here.
    if (event === "remove" || event === "clear") {
      await tx.cellPlanting.updateMany({
        where: { cellId: cell.id, removedAt: null },
        data: { removedAt: new Date() },
      });
    }

    if (activePlantings.length > 0) {
      await tx.gridCellEvent.createMany({
        data: activePlantings.map((planting) => ({
          cellId: cell.id,
          eventType: newStatus,
          plantId: planting.plantId,
        })),
      });
    } else {
      // No active planting to attribute the event to (shouldn't normally
      // happen for germinate/grow/harvest, but the status change itself is
      // still recorded).
      await tx.gridCellEvent.create({ data: { cellId: cell.id, eventType: newStatus } });
    }

    await tx.gridCell.update({ where: { id: cell.id }, data: { status: newStatus } });
  });
}

export function germinate(prisma: PrismaClient, input: CellLookup): Promise<void> {
  return advanceLifecycle(prisma, input, "germinate");
}

export function grow(prisma: PrismaClient, input: CellLookup): Promise<void> {
  return advanceLifecycle(prisma, input, "grow");
}

export function harvest(prisma: PrismaClient, input: CellLookup): Promise<void> {
  return advanceLifecycle(prisma, input, "harvest");
}

export function clearCell(prisma: PrismaClient, input: CellLookup): Promise<void> {
  return advanceLifecycle(prisma, input, "clear");
}

export function removeCell(prisma: PrismaClient, input: CellLookup): Promise<void> {
  return advanceLifecycle(prisma, input, "remove");
}

// Local mirrors of the growth domain's Prisma-backed enums (same pattern as
// this file's own CellStatus, imported from planting-lifecycle.ts rather
// than @prisma/client): the grid domain reads PlantingBiologyState +
// SpeciesProfile as plain Prisma-joined columns here, not via a
// growth-domain code import, so the grid domain's snapshot stays the single
// read model for the 2D/3D views without taking on a logic dependency on
// the growth engine.
export type PhenologyStage =
  | "GERMINATING"
  | "VEGETATIVE"
  | "FLOWERING"
  | "FRUITING"
  | "MATURE"
  | "SENESCENT"
  | "DEAD";
export type GrowthHabit = "UPRIGHT_BUSH" | "VINING" | "ROSETTE_LEAFY" | "ROOT_CROP";

// Absent when a planting hasn't had its first growth catch-up yet (see
// actions.ts, which runs catchUpGrowth before every snapshot read — this
// should only ever be transiently missing).
export interface PlantingGrowthView {
  phenologyStage: PhenologyStage;
  leafFraction: number;
  stemFraction: number;
  rootFraction: number;
  flowerFraction: number;
  fruitFraction: number;
  waterContentIndex: number;
  cumulativeStress: number;
  // Whichever of stress-service.ts's 8 dials was dominant on the plant's
  // last simulated day (e.g. "nutrient", "overwater", "wind"), or null when
  // nothing crossed the display threshold — see dominantStressLabel.
  dominantStressDial: string | null;
  growthHabit: GrowthHabit;
  primaryColor: string;
  matureHeightCm: number;
  // GDD accumulator + the four stage thresholds this planting's species uses
  // to advance phenology (see growth-engine-service.ts's module-private
  // nextPhenologyStage, which this view intentionally does NOT import — see
  // growth-progress.ts in components/garden for the UI-layer mirror of that
  // stage-order logic, following this file's existing "local mirror" pattern
  // for PhenologyStage above).
  accumulatedGdd: number;
  gddToVegetative: number;
  gddToFlowering: number;
  gddToFruiting: number;
  gddToMaturity: number;
  // Duplicated from the cell's CellEnvironmentView (not planting-specific,
  // but companion plantings in the same cell share one soil) so Plant.tsx's
  // chlorosis tint can stay a pure function of the one `growth` prop it
  // already receives, instead of needing a second per-cell data source
  // threaded through the 3D scene tree.
  micronutrientIndexFraction: number;
  // The planting's first active (resolvedAt: null) disease infection, or
  // null — duplicated from the planting's own `infections` array onto
  // `growth` for the same reason micronutrientIndexFraction is duplicated
  // above: Plant.tsx's leaf-spot tint stays a pure function of the one
  // `growth` prop it already receives.
  infection: { diseaseKey: string; severity: number } | null;
}

// Per-cell soil state — surfaced separately from PlantingGrowthView because
// nutrients/mulch live on CellEnvironmentState (one per cell), not per
// planting (a cell can hold multiple companion plantings sharing the same
// soil). Absent under the same transient first-catch-up window as growth.
export interface CellEnvironmentView {
  soilMoistureFraction: number;
  soilTempC: number;
  nitrogenPoolFraction: number;
  phosphorusPoolFraction: number;
  potassiumPoolFraction: number;
  calciumPoolFraction: number;
  micronutrientIndexFraction: number;
  residueOrganicMatterPool: number;
  mulchDepthMm: number;
  daysNearSaturation: number;
  weedPressureFraction: number;
  // Recomputed for display from today's weather + mulch depth (see
  // estimateEvapotranspirationDisplayMm) rather than persisted — the real
  // simulation computes and discards this same figure once per simulated
  // day, so there's no historical log to read back, only "today's" value.
  evapotranspirationMm: number;
}

// One bed's soil texture — SoilProfile is one row per Bed (a raised bed is
// normally a uniform fill), not per cell. Null before getOrCreateSoilProfile
// first runs for a bed (self-healing, same null-safety as CellEnvironmentView).
export interface SnapshotSoilProfile {
  sandPct: number;
  siltPct: number;
  clayPct: number;
  fieldCapacityFraction: number;
  wiltingPointFraction: number;
}

// Which companion-effect kind(s) a planting is currently receiving from
// OTHER plantings co-planted in the SAME cell — deliberately not bed-wide
// adjacency (ecology-service.ts's proximityStrength also credits
// orthogonally-adjacent cells at half strength, but that's a distance-
// weighted magnitude for the biology engine, a different job from "which
// badge does this cell show").
export interface SnapshotCompanionEffect {
  kind: CompanionEffectKind;
  sourceSpeciesKey: string;
}

// Local mirror of the conditions domain's Prisma enum, same rationale as
// PhenologyStage/GrowthHabit above.
export type ConditionOverrideKind = "SHADE_CLOTH" | "GROW_LIGHT" | "RAIN_COVER";

export interface SnapshotEquipment {
  id: string;
  kind: ConditionOverrideKind;
  intensity: number;
  installedAt: Date;
}

// Active (resolvedAt: null) disease infection on one planting — joined from
// DiseaseInfection (per-CellPlanting, not per-cell: a companion-planted
// cell can hold two plantings, each with its own independent infection).
export interface SnapshotInfection {
  diseaseKey: string;
  severity: number;
  startedAt: Date;
}

// Bed-level pest/predator population rows — see PestPopulation/
// PredatorPopulation in prisma/schema.prisma. Unbounded nonnegative
// floats, not 0..1 fractions; rows persist near-zero once created
// (upsert-based), so near-zero filtering is a display-layer concern, not
// this read model's job.
export interface SnapshotPestPopulation {
  pestKey: string;
  population: number;
}

export interface SnapshotPredatorPopulation {
  predatorKey: string;
  population: number;
}

// Rain barrels are standalone yard objects, not bed-scoped equipment — the
// 3D model places both beside the garden rather than inside either bed, and
// RainBarrel has no bedId (see prisma/schema.prisma). yardSlot is what maps
// this row to its RainBarrel_<n>_* GLB node group and 2D display order.
export interface SnapshotRainBarrel {
  id: string;
  yardSlot: number;
  capacityGallons: number;
  currentGallons: number;
  catchmentAreaSqFt: number;
  status: RainBarrelStatus;
}

interface SnapshotCell {
  column: number;
  row: number;
  status: CellStatus;
  plantIds: string[];
  environment: CellEnvironmentView | null;
  plantings: Array<{
    id: string;
    plantId: string;
    harvestCount: number;
    growth: PlantingGrowthView | null;
    infections: SnapshotInfection[];
    companionEffects: SnapshotCompanionEffect[];
  }>;
}

interface SnapshotBed {
  id: string;
  name: string;
  gridCols: number;
  gridRows: number;
  cells: SnapshotCell[];
  // Active (not removed) real equipment overrides on this bed — see
  // src/domain/conditions/bed-condition-override-service.ts. Joined here
  // (a plain Prisma include, not a code import of the conditions domain)
  // so the grid snapshot stays the single read model for 2D/3D, matching
  // how growth's PlantingBiologyState/SpeciesProfile are joined above.
  equipment: SnapshotEquipment[];
  // Bed-scoped pest/predator population rows — see
  // src/domain/pests/{pest-catalog,predator-catalog}.ts for the finite key
  // sets these pestKey/predatorKey strings resolve against.
  pests: SnapshotPestPopulation[];
  predators: SnapshotPredatorPopulation[];
  soilProfile: SnapshotSoilProfile | null;
}

// Garden-wide (not per-cell/per-bed) simulation context: current sim time,
// clock rate, sun position/times, and today's weather. All derived/read,
// nothing written — mirrors src/domain/viewer/viewer-read-model.ts's
// existing pattern of composing per-domain read functions rather than a
// bespoke query.
export interface GardenEnvironmentView {
  simTimeIso: string;
  clockRate: number;
  phase: DayNightPhase;
  sunAltitudeRad: number;
  sunAzimuthRad: number;
  sunriseIso: string;
  sunsetIso: string;
  weather: WeatherDayView | null;
  forecast: WeatherDayView[];
}

export interface GardenSnapshot {
  beds: SnapshotBed[];
  environment: GardenEnvironmentView;
  rainBarrels: SnapshotRainBarrel[];
}

// Which effect kinds a planting at `index` receives from every OTHER
// planting co-planted in the same cell — same-cell only (see
// SnapshotCompanionEffect's doc comment for why bed-wide adjacency is out
// of scope here). Deduped by kind: two same-cell sources of the same kind
// (e.g. two nitrogen-fixers) still render as one badge, not two.
function companionEffectsForCell(
  speciesKeys: ReadonlyArray<string | null>,
  index: number,
): SnapshotCompanionEffect[] {
  const targetSpeciesKey = speciesKeys[index];
  const effects = new Map<CompanionEffectKind, SnapshotCompanionEffect>();
  speciesKeys.forEach((otherSpeciesKey, otherIndex) => {
    if (otherIndex === index || !otherSpeciesKey) {
      return;
    }
    for (const source of companionEffectsForSpecies(otherSpeciesKey)) {
      if (source.targetSpeciesKey && source.targetSpeciesKey !== targetSpeciesKey) {
        continue;
      }
      if (!effects.has(source.kind)) {
        effects.set(source.kind, { kind: source.kind, sourceSpeciesKey: otherSpeciesKey });
      }
    }
  });
  return Array.from(effects.values());
}

// The read-model AC-1 depends on: reconciled current plant-or-empty state
// per cell, derived from the append-only journal (CellPlanting rows with
// removedAt: null). SPEC-VIEWER-001 owns the actual 3D render of this data.
//
// `options.at` is the real-world instant used to derive the current sim
// time (getCurrentSimTime's own `now` parameter) — defaults to the actual
// current time; only ever overridden by tests.
export async function getGardenSnapshot(
  prisma: PrismaClient,
  options?: { at?: Date },
): Promise<GardenSnapshot> {
  const [beds, rainBarrels, clock, location] = await Promise.all([
    prisma.bed.findMany({
      include: {
        cells: {
          // seedBed inserts column-major (see its own loop), not row-major -
          // without an explicit order here, consumers that assume array order
          // reflects (row, column) reading order get it wrong. Matches
          // getViewerCells' existing ordering for the same reason.
          orderBy: [{ row: "asc" }, { column: "asc" }],
          include: {
            environmentState: true,
            cellPlantings: {
              where: { removedAt: null },
              include: {
                _count: { select: { harvestRecords: true } },
                biologyState: true,
                plant: { include: { speciesProfile: true } },
                diseaseInfections: { where: { resolvedAt: null } },
              },
            },
          },
        },
        conditionOverrides: {
          where: { removedAt: null },
          orderBy: { installedAt: "asc" },
        },
        pestPopulations: true,
        predatorPopulations: true,
        soilProfile: true,
      },
    }),
    prisma.rainBarrel.findMany({ orderBy: { yardSlot: "asc" } }),
    getCurrentSimTime(prisma, options?.at),
    getGardenLocation(prisma),
  ]);

  const sunTimes = computeSunTimes(location, clock.simTime);
  const sunPosition = computeSunPosition(location, clock.simTime);
  const phase = computePhase(location, clock.simTime);
  const weather = await getWeatherDayView(prisma, clock.simTime);
  const forecast = await getForecastView(prisma, clock.simTime);
  // A planting's speciesProfile can be null (onDelete: SetNull on
  // Plant.speciesProfileId) — mirrors the fallback already applied in
  // catch-up-service.ts and whatif-projection-service.ts so the 3D viewer
  // always has a growth model to render from instead of silently omitting
  // the planting's growth data.
  const fallbackSpecies = await getFallbackSpeciesProfile(prisma);

  return {
    beds: beds.map((bed) => ({
      id: bed.id,
      name: bed.name,
      gridCols: bed.gridCols,
      gridRows: bed.gridRows,
      equipment: bed.conditionOverrides.map((override) => ({
        id: override.id,
        kind: override.kind as ConditionOverrideKind,
        intensity: override.intensity,
        installedAt: override.installedAt,
      })),
      pests: bed.pestPopulations.map((row) => ({
        pestKey: row.pestKey,
        population: row.population,
      })),
      predators: bed.predatorPopulations.map((row) => ({
        predatorKey: row.predatorKey,
        population: row.population,
      })),
      soilProfile: bed.soilProfile
        ? {
            sandPct: bed.soilProfile.sandPct,
            siltPct: bed.soilProfile.siltPct,
            clayPct: bed.soilProfile.clayPct,
            fieldCapacityFraction: bed.soilProfile.fieldCapacityFraction,
            wiltingPointFraction: bed.soilProfile.wiltingPointFraction,
          }
        : null,
      cells: bed.cells.map((cell) => {
        const speciesKeys = cell.cellPlantings.map(
          (planting) => planting.plant.speciesProfile?.key ?? guessSpeciesKey(planting.plant.commonName),
        );
        return {
          column: cell.column,
          row: cell.row,
          status: cell.status as CellStatus,
          plantIds: cell.cellPlantings.map((planting) => planting.plantId),
          environment: cell.environmentState
            ? {
                soilMoistureFraction: cell.environmentState.soilMoistureFraction,
                soilTempC: cell.environmentState.soilTempC,
                nitrogenPoolFraction: cell.environmentState.nitrogenPoolFraction,
                phosphorusPoolFraction: cell.environmentState.phosphorusPoolFraction,
                potassiumPoolFraction: cell.environmentState.potassiumPoolFraction,
                calciumPoolFraction: cell.environmentState.calciumPoolFraction,
                micronutrientIndexFraction: cell.environmentState.micronutrientIndexFraction,
                residueOrganicMatterPool: cell.environmentState.residueOrganicMatterPool,
                mulchDepthMm: cell.environmentState.mulchDepthMm,
                daysNearSaturation: cell.environmentState.daysNearSaturation,
                weedPressureFraction: cell.environmentState.weedPressureFraction,
                evapotranspirationMm: weather
                  ? estimateEvapotranspirationDisplayMm({
                      meanTempC: (weather.tempHighC + weather.tempLowC) / 2,
                      mulchDepthMm: cell.environmentState.mulchDepthMm,
                    })
                  : 0,
              }
            : null,
          plantings: cell.cellPlantings.map((planting, index) => ({
          id: planting.id,
          plantId: planting.plantId,
          harvestCount: planting._count.harvestRecords,
          infections: planting.diseaseInfections.map((infection) => ({
            diseaseKey: infection.diseaseKey,
            severity: infection.severity,
            startedAt: infection.startedAt,
          })),
          companionEffects: companionEffectsForCell(speciesKeys, index),
          growth: planting.biologyState
            ? (() => {
                const species = planting.plant.speciesProfile ?? fallbackSpecies;
                return {
                  phenologyStage: planting.biologyState.phenologyStage as PhenologyStage,
                  leafFraction: planting.biologyState.leafFraction,
                  stemFraction: planting.biologyState.stemFraction,
                  rootFraction: planting.biologyState.rootFraction,
                  flowerFraction: planting.biologyState.flowerFraction,
                  fruitFraction: planting.biologyState.fruitFraction,
                  waterContentIndex: planting.biologyState.waterContentIndex,
                  cumulativeStress: planting.biologyState.cumulativeStress,
                  dominantStressDial: planting.biologyState.dominantStressDial,
                  growthHabit: species.growthHabit as GrowthHabit,
                  primaryColor: species.primaryColor,
                  matureHeightCm: species.matureHeightCm,
                  accumulatedGdd: planting.biologyState.accumulatedGdd,
                  gddToVegetative: species.gddToVegetative,
                  gddToFlowering: species.gddToFlowering,
                  gddToFruiting: species.gddToFruiting,
                  gddToMaturity: species.gddToMaturity,
                  micronutrientIndexFraction: cell.environmentState?.micronutrientIndexFraction ?? 0.6,
                  infection: planting.diseaseInfections[0]
                    ? {
                        diseaseKey: planting.diseaseInfections[0].diseaseKey,
                        severity: planting.diseaseInfections[0].severity,
                      }
                    : null,
                };
              })()
            : null,
        })),
        };
      }),
    })),
    environment: {
      simTimeIso: clock.simTime.toISOString(),
      clockRate: clock.rate,
      phase,
      sunAltitudeRad: sunPosition.altitudeRad,
      sunAzimuthRad: sunPosition.azimuthRad,
      sunriseIso: sunTimes.sunrise.toISOString(),
      sunsetIso: sunTimes.sunset.toISOString(),
      weather,
      forecast,
    },
    rainBarrels: rainBarrels.map((barrel) => ({
      id: barrel.id,
      yardSlot: barrel.yardSlot,
      capacityGallons: barrel.capacityGallons,
      currentGallons: barrel.currentGallons,
      catchmentAreaSqFt: barrel.catchmentAreaSqFt,
      status: barrel.status,
    })),
  };
}

export interface InventoryAssignmentInput extends AssignPlantInput {
  amount: number;
  mode: "replace" | "companion";
}

// The stock adjustment and every planting/journal write share one transaction:
// a failed drop can never consume inventory without assigning the plant.
export async function assignInventoryPlant(
  prisma: PrismaClient,
  input: InventoryAssignmentInput,
): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new InventoryValidationError("Enter an amount greater than zero.");
  }

  await prisma.$transaction(async (tx) => {
    const plant = await tx.plant.findFirstOrThrow({
      where: { id: input.plantId, archivedAt: null },
    });
    if (plant.seedQuantity < input.amount) {
      throw new InventoryValidationError(`Only ${plant.seedQuantity} seeds available.`);
    }

    const cell = await tx.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: input.bedId, column: input.column, row: input.row } },
    });
    const status = cell.status as CellStatus;
    const active = await tx.cellPlanting.findMany({
      where: { cellId: cell.id, removedAt: null },
    });

    if (status === "HARVESTED") {
      throw new HarvestedCellError("Finish and clear this harvested cell before planting again.");
    }
    if (input.mode === "companion") {
      if (active.length === 0 || status === "EMPTY" || status === "REMOVED") {
        throw new NoActivePlantingError("Assign a primary plant before adding a companion.");
      }
      if (active.some((planting) => planting.plantId === input.plantId)) {
        throw new DuplicateCompanionPlantError("That plant is already assigned to this cell.");
      }
    }

    await tx.plant.update({
      where: { id: plant.id },
      data: { seedQuantity: { decrement: input.amount } },
    });

    if (input.mode === "replace") {
      const now = new Date();
      await tx.cellPlanting.updateMany({
        where: { cellId: cell.id, removedAt: null },
        data: { removedAt: now },
      });
      if (active.length > 0) {
        await tx.gridCellEvent.createMany({
          data: active.map((planting) => ({
            cellId: cell.id,
            plantId: planting.plantId,
            eventType: "REMOVED" as CellStatus,
          })),
        });
      }
      await tx.cellPlanting.create({
        data: {
          cellId: cell.id,
          plantId: plant.id,
          seedQuantityUsed: input.amount,
          // Always "seed" now that seedQuantity is canonical seed-
          // equivalents — CellPlanting.seedUnit is read nowhere except
          // journal metadata, so this is safe to redefine.
          seedUnit: "seed",
        },
      });
      await tx.gridCellEvent.create({
        data: { cellId: cell.id, plantId: plant.id, eventType: "PLANTED" },
      });
      await tx.gridCell.update({
        where: { id: cell.id },
        data: { status: "PLANTED", plantedAt: now },
      });
      return;
    }

    await tx.cellPlanting.create({
      data: {
        cellId: cell.id,
        plantId: plant.id,
        seedQuantityUsed: input.amount,
        seedUnit: "seed",
      },
    });
    await tx.gridCellEvent.create({
      data: {
        cellId: cell.id,
        plantId: plant.id,
        eventType: status,
        note: "companion planting",
      },
    });
  });
}

export interface RecordHarvestInput {
  cellPlantingId: string;
  amount: number;
  unit: string;
  notes?: string | null;
  harvestedAt?: Date;
}

export async function recordHarvest(
  prisma: PrismaClient,
  input: RecordHarvestInput,
): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new InventoryValidationError("Harvest amount must be greater than zero.");
  }
  const unit = input.unit.trim();
  if (!unit) throw new InventoryValidationError("Harvest unit is required.");

  await prisma.$transaction(async (tx) => {
    const planting = await tx.cellPlanting.findUniqueOrThrow({
      where: { id: input.cellPlantingId },
      include: { cell: true },
    });
    if (planting.removedAt) {
      throw new NoActivePlantingError("That planting is no longer active.");
    }
    if (planting.cell.status !== "GROWING") {
      throw new InventoryValidationError("Yield can only be recorded for a growing plant.");
    }
    await tx.harvestRecord.create({
      data: {
        cellPlantingId: planting.id,
        plantId: planting.plantId,
        amount: input.amount,
        unit,
        notes: input.notes?.trim() || null,
        harvestedAt: input.harvestedAt,
      },
    });
  });
}

interface ResizeBedGeometryInput {
  bedId: string;
  gridCols: number;
  gridRows: number;
  renovation?: { note: string; occurredAt: Date };
}

// NC-SPRIG-GRID-IMMUTABLE-GEOMETRY: geometry must never be silently resized.
// A resize (a) is rejected without an explicit dated renovation, (b) persists
// that renovation as a durable audit record, and (c) reconciles GridCell rows
// to match the new dimensions. Shrinking a bed that would remove a cell with
// any journal history is rejected explicitly below — the onDelete: Restrict
// annotations in schema.prisma document the intent, but (per the datasource
// comment) delete-restrict emulation isn't reliably active for this driver
// setup either, so the check is enforced in code, not left to the schema.
export async function resizeBedGeometry(
  prisma: PrismaClient,
  input: ResizeBedGeometryInput,
): Promise<void> {
  if (!input.renovation) {
    throw new GeometryValidationError(
      "Bed geometry cannot be resized without an explicit, dated bed renovation record (NC-SPRIG-GRID-IMMUTABLE-GEOMETRY).",
    );
  }
  if (!Number.isInteger(input.gridCols) || !Number.isInteger(input.gridRows)) {
    throw new GeometryValidationError("Bed geometry dimensions must be whole numbers.");
  }
  if (input.gridCols < 1 || input.gridRows < 1) {
    throw new GeometryValidationError("Bed geometry must have at least 1 column and 1 row.");
  }
  if (input.renovation.note.trim().length === 0) {
    throw new GeometryValidationError(
      "A bed renovation record requires a non-empty note (NC-SPRIG-GRID-IMMUTABLE-GEOMETRY requires an explicit record).",
    );
  }

  const renovation = input.renovation;

  await prisma.$transaction(async (tx) => {
    const bed = await tx.bed.findUniqueOrThrow({ where: { id: input.bedId } });

    await tx.bedRenovation.create({
      data: {
        bedId: bed.id,
        note: renovation.note,
        occurredAt: renovation.occurredAt,
        previousCols: bed.gridCols,
        previousRows: bed.gridRows,
        newCols: input.gridCols,
        newRows: input.gridRows,
      },
    });

    await tx.bed.update({
      where: { id: bed.id },
      data: { gridCols: input.gridCols, gridRows: input.gridRows },
    });

    const existingCells = await tx.gridCell.findMany({ where: { bedId: bed.id } });

    const cellsToAdd = [];
    for (let column = 1; column <= input.gridCols; column += 1) {
      for (let row = 1; row <= input.gridRows; row += 1) {
        const alreadyExists = existingCells.some((c) => c.column === column && c.row === row);
        if (!alreadyExists) {
          cellsToAdd.push({
            bedId: bed.id,
            column,
            row,
            baselineLight: baselineLightFor(row, input.gridRows),
          });
        }
      }
    }
    if (cellsToAdd.length > 0) {
      await tx.gridCell.createMany({ data: cellsToAdd });
    }

    // baselineLight is derived from current geometry (row position relative
    // to gridRows), not a fixed-at-creation historical fact — a gridRows
    // change must recompute it for cells that already existed, not just the
    // newly-added ones, or the gradient goes internally inconsistent.
    const survivingCells = existingCells.filter(
      (c) => c.column <= input.gridCols && c.row <= input.gridRows,
    );
    for (const cell of survivingCells) {
      const recomputed = baselineLightFor(cell.row, input.gridRows);
      if (recomputed !== cell.baselineLight) {
        await tx.gridCell.update({ where: { id: cell.id }, data: { baselineLight: recomputed } });
      }
    }

    const cellsToRemove = existingCells.filter(
      (c) => c.column > input.gridCols || c.row > input.gridRows,
    );
    for (const cell of cellsToRemove) {
      const [plantingCount, eventCount] = await Promise.all([
        tx.cellPlanting.count({ where: { cellId: cell.id } }),
        tx.gridCellEvent.count({ where: { cellId: cell.id } }),
      ]);
      if (plantingCount > 0 || eventCount > 0) {
        throw new JournalIntegrityViolationError(
          `Cannot shrink bed: cell (col ${cell.column}, row ${cell.row}) has planting/journal ` +
            "history; removing it would violate NC-SPRIG-NO-OVERWRITE-JOURNAL.",
        );
      }
      await tx.gridCell.delete({ where: { id: cell.id } });
    }
  });
}
