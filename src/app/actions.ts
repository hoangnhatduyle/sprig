"use server";

import type { BedConditionOverride, ConditionOverrideKind, Plant } from "@prisma/client";
import { DuplicateCompanionPlantError, HarvestedCellError, NoActivePlantingError } from "@/domain/grid/errors";
import { LifecycleTransitionError } from "@/domain/grid/planting-lifecycle";
import {
  addCompanionPlant,
  assignInventoryPlant,
  assignPlant,
  getGardenSnapshot,
  harvest,
  recordHarvest,
  removePlanting,
} from "@/domain/grid/grid-cell-service";
import type { GardenSnapshot } from "@/domain/grid/grid-cell-service";
import { catchUpGrowth } from "@/domain/growth/catch-up-service";
import { resetSimClockToNow, setClockRate } from "@/domain/growth/sim-clock-service";
import { InvalidClockRateError } from "@/domain/growth/errors";
import {
  installConditionOverride,
  listActiveConditionOverrides,
  removeConditionOverride,
} from "@/domain/conditions/bed-condition-override-service";
import { InvalidConditionIntensityError, InvalidProjectionInputError } from "@/domain/conditions/errors";
import {
  runWhatIfProjection,
  type PlantingProjection,
  type ProjectionOverrideInput,
} from "@/domain/conditions/whatif-projection-service";
import {
  applyCompostToCell,
  applyFertilizerToCell,
  applyMulchToCell,
  applyWeedingToCell,
  type FertilizerKind,
} from "@/domain/soil/care-actions-service";
import { InvalidCareActionAmountError } from "@/domain/soil/errors";
import { applyFungicideToCell } from "@/domain/disease/disease-action-service";
import { applyPesticideToBed, releasePredatorsToBed } from "@/domain/pests/pest-action-service";
import { InvalidPestActionAmountError, UnknownPestKeyError, UnknownPredatorKeyError } from "@/domain/pests/errors";
import {
  createInventoryPlant,
  deleteInventoryPlant,
  getInventorySnapshot,
  InventoryValidationError,
  type InventorySnapshot,
  type PlantInput,
  updateInventoryPlant,
  updatePlantImageMetadata,
} from "@/domain/plant-catalog/inventory-service";
import { listPlants } from "@/domain/plant-catalog/plant-catalog-service";
import { SimulationRunTransitionError } from "@/domain/simulation/simulation-run-lifecycle";
import {
  configureRun,
  createDraftRun,
  finishRun,
  startRun,
  updateRunScenario,
} from "@/domain/simulation/simulation-service";
import { getGardenJournal, type GardenJournal, type JournalEntryKind } from "@/domain/journal/journal-service";
import { createJournalNote } from "@/domain/journal/journal-note-service";
import { getSeasonRecap, type SeasonRecap } from "@/domain/journal/season-recap-service";
import { getYieldTrend, type YieldTrendPoint } from "@/domain/journal/yield-trend-service";
import { JournalValidationError } from "@/domain/journal/errors";
import { startNewSeason } from "@/domain/season/season-reset-service";
import { getWeatherRangeView, type WeatherDayView } from "@/domain/weather/weather-service";
import { prisma } from "@/lib/prisma";
import { PlantImageError, removePlantImage, storePlantImage } from "@/lib/plant-images";
import { JournalPhotoError, removeJournalPhoto, storeJournalPhoto } from "@/lib/journal-photos";

export interface CellTarget {
  bedId: string;
  column: number;
  row: number;
  plantId: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// Server Actions are reachable like a public endpoint — validate the shape
// at runtime rather than trusting the caller's TypeScript types, which are
// erased by the time a request actually arrives.
function isValidCellTarget(value: unknown): value is CellTarget {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const target = value as Record<string, unknown>;
  return (
    typeof target.bedId === "string" &&
    target.bedId.length > 0 &&
    typeof target.plantId === "string" &&
    target.plantId.length > 0 &&
    Number.isInteger(target.column) &&
    (target.column as number) > 0 &&
    Number.isInteger(target.row) &&
    (target.row as number) > 0
  );
}

function describeGridError(error: unknown): string {
  if (error instanceof HarvestedCellError) {
    return "This cell has been harvested — clear or remove it before assigning a new plant.";
  }
  if (error instanceof NoActivePlantingError) {
    // Thrown with an already user-presentable message from each of GRID's
    // call sites (add-companion-on-empty, remove-a-plant-that-isn't-there,
    // remove-the-last-planting) — a single canned string here would be
    // wrong for at least one of those callers.
    return error.message;
  }
  if (error instanceof DuplicateCompanionPlantError) {
    return "That plant is already assigned to this cell.";
  }
  if (error instanceof LifecycleTransitionError) {
    return "This cell's state changed before that could complete. Refresh and try again.";
  }
  // Unrecognized error (e.g. a raw Prisma "record not found" error): never
  // forward internal error text to the client — log it server-side and
  // return a safe, generic message instead.
  console.error("[PLANTUI] unexpected grid error:", error);
  return "Something went wrong. Please try again.";
}

export async function assignPlantAction(target: CellTarget): Promise<ActionResult> {
  if (!isValidCellTarget(target)) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await assignPlant(prisma, target);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describeGridError(error) };
  }
}

export async function addCompanionPlantAction(target: CellTarget): Promise<ActionResult> {
  if (!isValidCellTarget(target)) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await addCompanionPlant(prisma, target);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describeGridError(error) };
  }
}

// Removes exactly one plant (identified by plantId) from a cell — vacates
// the whole cell if it was the only active planting, or leaves the rest of
// a companion-planted cell untouched otherwise. See removePlanting's own
// comment for which of GRID's two removal primitives applies.
export async function removePlantingAction(target: CellTarget): Promise<ActionResult> {
  if (!isValidCellTarget(target)) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await removePlanting(prisma, target);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describeGridError(error) };
  }
}

// catchUpGrowth runs the growth engine's daily step for every simulated day
// that's elapsed since the last read (src/domain/growth/catch-up-service.ts)
// before the snapshot is computed — this is the "derive on read" trigger
// point the architecture doc's §2 calls for, mirroring how the irrigation
// domain's maybeTriggerDailyCycle is invoked on read rather than by a
// background worker.
export async function refreshGardenSnapshotAction(): Promise<GardenSnapshot> {
  // REAL_API here, not catchUpGrowth's own PROCEDURAL default — that
  // default is what lets the test suite call catchUpGrowth without mocking
  // fetch or hitting the network. Every real app entry point opts into real
  // weather explicitly instead of the shared default changing under them.
  await catchUpGrowth(prisma, { weatherSource: "REAL_API" });
  return getGardenSnapshot(prisma);
}

export interface InventoryAssignmentTarget extends CellTarget {
  amount: number;
  mode: "replace" | "companion";
}

export interface WorkspaceSnapshot {
  garden: GardenSnapshot;
  inventory: InventorySnapshot;
}

export async function refreshWorkspaceAction(): Promise<WorkspaceSnapshot> {
  await catchUpGrowth(prisma, { weatherSource: "REAL_API" });
  const [garden, inventory] = await Promise.all([
    getGardenSnapshot(prisma),
    getInventorySnapshot(prisma),
  ]);
  return { garden, inventory };
}

export interface SetClockRateResult extends ActionResult {
  simTimeIso?: string;
  rate?: number;
}

function describeClockError(error: unknown): string {
  if (error instanceof InvalidClockRateError) {
    return error.message;
  }
  console.error("[CLOCK] unexpected clock error:", error);
  return "Something went wrong. Please try again.";
}

// The one control surface for SimClockEpoch (src/domain/growth/sim-clock-service.ts)
// — without this the clock silently sits at its no-epoch default (1x real
// time), so every other Phase A signal (weather, equipment effects, growth)
// would appear frozen. Presets only (see SimClockControl.tsx) — no
// free-text rate, no scrub-back; setClockRate itself still enforces
// 0 <= rate <= MAX_CLOCK_RATE and rejects anything else.
export async function setClockRateAction(rate: number): Promise<SetClockRateResult> {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    return { ok: false, error: "Invalid clock rate." };
  }
  try {
    const state = await setClockRate(prisma, rate);
    return { ok: true, simTimeIso: state.simTime.toISOString(), rate: state.rate };
  } catch (error: unknown) {
    return { ok: false, error: describeClockError(error) };
  }
}

// "Return to current time" — see resetSimClockToNow's own comment for why
// this is a separate epoch write from setClockRateAction rather than just
// calling that with the current rate.
export async function resetSimClockToNowAction(): Promise<SetClockRateResult> {
  try {
    const state = await resetSimClockToNow(prisma);
    return { ok: true, simTimeIso: state.simTime.toISOString(), rate: state.rate };
  } catch (error: unknown) {
    return { ok: false, error: describeClockError(error) };
  }
}

function isInventoryAssignment(value: unknown): value is InventoryAssignmentTarget {
  if (!isValidCellTarget(value)) return false;
  const target = value as unknown as Record<string, unknown>;
  return (
    typeof target.amount === "number" &&
    Number.isFinite(target.amount) &&
    target.amount > 0 &&
    (target.mode === "replace" || target.mode === "companion")
  );
}

function describeInventoryError(error: unknown): string {
  if (error instanceof InventoryValidationError || error instanceof PlantImageError) {
    return error.message;
  }
  return describeGridError(error);
}

export async function assignInventoryPlantAction(
  target: InventoryAssignmentTarget,
): Promise<ActionResult> {
  if (!isInventoryAssignment(target)) return { ok: false, error: "Invalid request." };
  try {
    await assignInventoryPlant(prisma, target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeInventoryError(error) };
  }
}

function isPlantInput(value: unknown): value is PlantInput {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.commonName === "string" &&
    typeof input.seedQuantity === "number" &&
    Number.isFinite(input.seedQuantity) &&
    typeof input.seedUnit === "string" &&
    (input.species === undefined || input.species === null || typeof input.species === "string") &&
    (input.notes === undefined || input.notes === null || typeof input.notes === "string") &&
    (input.waterNeed === undefined || input.waterNeed === null || typeof input.waterNeed === "string") &&
    (input.lightNeed === undefined || input.lightNeed === null || typeof input.lightNeed === "string") &&
    (input.isCompanionPlanting === undefined || typeof input.isCompanionPlanting === "boolean")
  );
}

export async function createInventoryPlantAction(input: PlantInput): Promise<ActionResult> {
  if (!isPlantInput(input)) return { ok: false, error: "Invalid plant details." };
  try {
    await createInventoryPlant(prisma, input);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeInventoryError(error) };
  }
}

export async function updateInventoryPlantAction(
  id: string,
  input: PlantInput,
): Promise<ActionResult> {
  if (!id || !isPlantInput(input)) return { ok: false, error: "Invalid plant details." };
  try {
    await updateInventoryPlant(prisma, id, input);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeInventoryError(error) };
  }
}

export async function deleteInventoryPlantAction(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "Invalid request." };
  try {
    const plant = await prisma.plant.findUnique({
      where: { id },
      select: { imageFilename: true },
    });
    const result = await deleteInventoryPlant(prisma, id);
    if (result === "deleted") await removePlantImage(plant?.imageFilename ?? null);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeInventoryError(error) };
  }
}

export async function uploadPlantImageAction(formData: FormData): Promise<ActionResult> {
  const plantId = formData.get("plantId");
  const file = formData.get("image");
  if (typeof plantId !== "string" || !plantId || !(file instanceof File)) {
    return { ok: false, error: "Choose an image to upload." };
  }
  let stored: { filename: string; mimeType: string } | null = null;
  try {
    stored = await storePlantImage(file);
    const previous = await updatePlantImageMetadata(
      prisma,
      plantId,
      stored.filename,
      stored.mimeType,
    );
    await removePlantImage(previous);
    return { ok: true };
  } catch (error) {
    if (stored) await removePlantImage(stored.filename);
    return { ok: false, error: describeInventoryError(error) };
  }
}

export async function recordHarvestAction(input: {
  cellPlantingId: string;
  amount: number;
  unit: string;
  notes?: string;
}): Promise<ActionResult> {
  if (
    !input ||
    typeof input.cellPlantingId !== "string" ||
    typeof input.amount !== "number" ||
    typeof input.unit !== "string"
  ) {
    return { ok: false, error: "Invalid harvest details." };
  }
  try {
    await recordHarvest(prisma, input);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeInventoryError(error) };
  }
}

// Growth stage now advances automatically (src/domain/growth/catch-up-service.ts,
// driven by simulated time + weather, invoked from the refresh actions
// above) — germinate/grow are no longer user-triggered events. Harvest
// completion ("finish") stays a real action because deciding a planting is
// done is a genuine human decision, not something the growth engine should
// infer.
export async function advancePlantingAction(
  target: Omit<CellTarget, "plantId">,
  event: "finish",
): Promise<ActionResult> {
  if (
    !target ||
    typeof target.bedId !== "string" ||
    !Number.isInteger(target.column) ||
    !Number.isInteger(target.row) ||
    event !== "finish"
  ) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await harvest(prisma, target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeInventoryError(error) };
  }
}

export interface StartSimulationResult {
  ok: boolean;
  runId?: string;
  error?: string;
}

function describeSimulationError(error: unknown): string {
  if (error instanceof SimulationRunTransitionError) {
    // Logged even though a user-facing message is also returned: the message
    // below assumes the common case (the run already finished), but this
    // error covers every rejected hop in the lifecycle table, and without a
    // log there's no way to tell which one actually fired.
    console.error("[VIEWER] rejected simulation transition:", error);
    return "That simulation run has already finished. Start a new one to keep exploring.";
  }
  console.error("[VIEWER] unexpected simulation error:", error);
  return "Couldn't start the simulation. Please try again.";
}

// DRAFT -> CONFIGURED -> RUNNING in one call: the viewer has no separate
// "configure" step in its UI (the scenario is just the simulated time-of-day
// the user opens with), so exposing three round trips would only create
// windows where a half-configured run could be left behind.
export async function startSimulationRunAction(
  simulatedTimeIso: string | null,
): Promise<StartSimulationResult> {
  if (simulatedTimeIso !== null && typeof simulatedTimeIso !== "string") {
    return { ok: false, error: "Invalid request." };
  }
  const simulatedTime = simulatedTimeIso === null ? null : new Date(simulatedTimeIso);
  if (simulatedTime !== null && Number.isNaN(simulatedTime.getTime())) {
    return { ok: false, error: "Invalid request." };
  }

  try {
    const draft = await createDraftRun(prisma);
    // Empty waterInput: simulated watering is applied as a client-side
    // overlay while the run is RUNNING, never as a write to the real
    // journal (NC-SPRIG-NO-OVERWRITE-JOURNAL).
    await configureRun(prisma, draft.id, { waterInput: {}, simulatedTime });
    const run = await startRun(prisma, draft.id);
    return { ok: true, runId: run.id };
  } catch (error: unknown) {
    return { ok: false, error: describeSimulationError(error) };
  }
}

export interface SyncSimulationScenarioResult {
  ok: boolean;
  error?: string;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
  );
}

// Called as the user interacts with an already-RUNNING simulation (waters a
// cell, scrubs the time slider) — not just once at start — so the persisted
// SimulationRun row reflects what was actually simulated (SPEC-VIEWER-002
// AC-2), not only the empty defaults startSimulationRunAction captures. A
// nominal water amount (1) is recorded per watered cell id: the viewer's UI
// concept is boolean watered/not-watered (applySimulationWater, the
// client-side overlay), not a metered quantity, so there's no real "amount"
// to persist beyond presence.
export async function syncSimulationScenarioAction(
  runId: string,
  wateredCellIds: string[],
  simulatedTimeIso: string | null,
): Promise<SyncSimulationScenarioResult> {
  if (typeof runId !== "string" || runId.length === 0 || !isStringArray(wateredCellIds)) {
    return { ok: false, error: "Invalid request." };
  }
  if (simulatedTimeIso !== null && typeof simulatedTimeIso !== "string") {
    return { ok: false, error: "Invalid request." };
  }
  const simulatedTime = simulatedTimeIso === null ? null : new Date(simulatedTimeIso);
  if (simulatedTime !== null && Number.isNaN(simulatedTime.getTime())) {
    return { ok: false, error: "Invalid request." };
  }

  const waterInput = Object.fromEntries(wateredCellIds.map((cellId) => [cellId, 1]));
  try {
    await updateRunScenario(prisma, runId, { waterInput, simulatedTime });
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describeSimulationError(error) };
  }
}

export async function finishSimulationRunAction(runId: string): Promise<ActionResult> {
  if (typeof runId !== "string" || runId.length === 0) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await finishRun(prisma, runId);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describeSimulationError(error) };
  }
}

export async function listPlantCatalogAction(): Promise<Plant[]> {
  return listPlants(prisma);
}

const CONDITION_KINDS: readonly ConditionOverrideKind[] = ["SHADE_CLOTH", "GROW_LIGHT", "RAIN_COVER"];

function describeConditionsError(error: unknown): string {
  if (error instanceof InvalidConditionIntensityError || error instanceof InvalidProjectionInputError) {
    return error.message;
  }
  console.error("[CONDITIONS] unexpected conditions error:", error);
  return "Something went wrong. Please try again.";
}

export interface InstallConditionOverrideResult {
  ok: boolean;
  override?: BedConditionOverride;
  error?: string;
}

// Real, persistent equipment (§19): actually changes the targeted bed's
// future real growth via catch-up-service.ts, bounded to realistic
// intensity ranges (bed-condition-override-service.ts's INTENSITY_BOUNDS)
// so this can't become a cheat code.
export async function installConditionOverrideAction(input: {
  bedId: string;
  kind: ConditionOverrideKind;
  intensity: number;
}): Promise<InstallConditionOverrideResult> {
  if (
    !input ||
    typeof input.bedId !== "string" ||
    !input.bedId ||
    !CONDITION_KINDS.includes(input.kind) ||
    typeof input.intensity !== "number"
  ) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    const override = await installConditionOverride(prisma, input);
    return { ok: true, override };
  } catch (error: unknown) {
    return { ok: false, error: describeConditionsError(error) };
  }
}

export async function removeConditionOverrideAction(overrideId: string): Promise<ActionResult> {
  if (typeof overrideId !== "string" || !overrideId) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await removeConditionOverride(prisma, overrideId);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describeConditionsError(error) };
  }
}

export async function listConditionOverridesAction(bedId: string): Promise<BedConditionOverride[]> {
  if (typeof bedId !== "string" || !bedId) {
    return [];
  }
  return listActiveConditionOverrides(prisma, bedId);
}

export interface PreviewConditionsResult {
  ok: boolean;
  projections?: PlantingProjection[];
  error?: string;
}

// What-if preview (§19): runs the real growth engine forward over a
// hypothetical scenario, starting from current real state, and returns the
// projected trajectory WITHOUT writing anything back — see
// whatif-projection-service.ts's NC-SPRIG-NO-OVERWRITE-JOURNAL note.
export async function previewConditionsAction(input: {
  bedIds: string[];
  projectionDays: number;
  overrides: ProjectionOverrideInput[];
}): Promise<PreviewConditionsResult> {
  if (
    !input ||
    !isStringArray(input.bedIds) ||
    typeof input.projectionDays !== "number" ||
    !Array.isArray(input.overrides)
  ) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    const projections = await runWhatIfProjection(prisma, input);
    return { ok: true, projections };
  } catch (error: unknown) {
    return { ok: false, error: describeConditionsError(error) };
  }
}

function describeCareActionError(error: unknown): string {
  if (error instanceof InvalidCareActionAmountError) {
    return error.message;
  }
  console.error("[CARE] unexpected care action error:", error);
  return "Something went wrong. Please try again.";
}

export async function applyMulchAction(input: {
  bedId: string;
  column: number;
  row: number;
  depthMm: number;
}): Promise<ActionResult> {
  if (
    !input ||
    typeof input.bedId !== "string" ||
    !input.bedId ||
    !Number.isInteger(input.column) ||
    !Number.isInteger(input.row) ||
    typeof input.depthMm !== "number"
  ) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await applyMulchToCell(prisma, input);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describeCareActionError(error) };
  }
}

export async function applyCompostAction(input: {
  bedId: string;
  column: number;
  row: number;
  amount: number;
}): Promise<ActionResult> {
  if (
    !input ||
    typeof input.bedId !== "string" ||
    !input.bedId ||
    !Number.isInteger(input.column) ||
    !Number.isInteger(input.row) ||
    typeof input.amount !== "number"
  ) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await applyCompostToCell(prisma, input);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describeCareActionError(error) };
  }
}

const FERTILIZER_KINDS: readonly FertilizerKind[] = ["SYNTHETIC", "ORGANIC"];

export async function applyFertilizerAction(input: {
  bedId: string;
  column: number;
  row: number;
  kind: FertilizerKind;
  n: number;
  p: number;
  k: number;
}): Promise<ActionResult> {
  if (
    !input ||
    typeof input.bedId !== "string" ||
    !input.bedId ||
    !Number.isInteger(input.column) ||
    !Number.isInteger(input.row) ||
    !FERTILIZER_KINDS.includes(input.kind) ||
    typeof input.n !== "number" ||
    typeof input.p !== "number" ||
    typeof input.k !== "number"
  ) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await applyFertilizerToCell(prisma, input);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describeCareActionError(error) };
  }
}

export async function applyWeedingAction(input: { bedId: string; column: number; row: number }): Promise<ActionResult> {
  if (!input || typeof input.bedId !== "string" || !input.bedId || !Number.isInteger(input.column) || !Number.isInteger(input.row)) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await applyWeedingToCell(prisma, input);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describeCareActionError(error) };
  }
}

function describePestActionError(error: unknown): string {
  if (error instanceof UnknownPestKeyError || error instanceof UnknownPredatorKeyError || error instanceof InvalidPestActionAmountError) {
    return error.message;
  }
  console.error("[PEST] unexpected pest/disease action error:", error);
  return "Something went wrong. Please try again.";
}

export async function applyFungicideAction(input: { bedId: string; column: number; row: number }): Promise<ActionResult> {
  if (!input || typeof input.bedId !== "string" || !input.bedId || !Number.isInteger(input.column) || !Number.isInteger(input.row)) {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await applyFungicideToCell(prisma, input);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describePestActionError(error) };
  }
}

export async function applyPesticideAction(input: {
  bedId: string;
  pestKey: string;
  broadSpectrum: boolean;
}): Promise<ActionResult> {
  if (!input || typeof input.bedId !== "string" || !input.bedId || typeof input.pestKey !== "string" || typeof input.broadSpectrum !== "boolean") {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await applyPesticideToBed(prisma, input);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describePestActionError(error) };
  }
}

export async function releasePredatorsAction(input: {
  bedId: string;
  predatorKey: string;
  amount: number;
}): Promise<ActionResult> {
  if (!input || typeof input.bedId !== "string" || !input.bedId || typeof input.predatorKey !== "string" || typeof input.amount !== "number") {
    return { ok: false, error: "Invalid request." };
  }
  try {
    await releasePredatorsToBed(prisma, input);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: describePestActionError(error) };
  }
}

export interface GardenJournalQuery {
  bedId?: string;
  column?: number;
  row?: number;
  plantId?: string;
  kinds?: JournalEntryKind[];
  includeSystemLifecycleEvents?: boolean;
  sinceIso?: string;
  untilIso?: string;
  limit?: number;
  offset?: number;
}

// The Journal's own read action — deliberately separate from
// refreshGardenSnapshotAction/refreshWorkspaceAction above, since journal
// entries are unbounded/filterable/paginated in a way the other two
// snapshot pieces aren't. Same "derive on read" catchUpGrowth-then-read
// order as every other read action in this file (see refreshGardenSnapshotAction's
// own comment) — DiseaseInfection/GridCellEvent rows for elapsed simulated
// days only exist once catch-up has run.
export async function getGardenJournalAction(query: GardenJournalQuery = {}): Promise<GardenJournal> {
  await catchUpGrowth(prisma, { weatherSource: "REAL_API" });
  let cellId: string | undefined;
  if (query.bedId && query.column != null && query.row != null) {
    const cell = await prisma.gridCell.findUnique({
      where: { bedId_column_row: { bedId: query.bedId, column: query.column, row: query.row } },
      select: { id: true },
    });
    cellId = cell?.id;
  }
  return getGardenJournal(prisma, {
    bedId: query.bedId,
    cellId,
    plantId: query.plantId,
    kinds: query.kinds,
    includeSystemLifecycleEvents: query.includeSystemLifecycleEvents,
    since: query.sinceIso ? new Date(query.sinceIso) : undefined,
    until: query.untilIso ? new Date(query.untilIso) : undefined,
    limit: query.limit,
    offset: query.offset,
  });
}

function describeJournalError(error: unknown): string {
  if (error instanceof JournalValidationError || error instanceof JournalPhotoError) {
    return error.message;
  }
  console.error("[JOURNAL] unexpected journal error:", error);
  return "Something went wrong. Please try again.";
}

// Mirrors uploadPlantImageAction above: an optional image File alongside
// freeform text, store-then-create, with the stored file cleaned up if the
// note write itself fails so a note is never half-created.
export async function createJournalNoteAction(formData: FormData): Promise<ActionResult> {
  const body = formData.get("body");
  const bedId = formData.get("bedId");
  const columnRaw = formData.get("column");
  const rowRaw = formData.get("row");
  const image = formData.get("image");

  let stored: { filename: string; mimeType: string } | null = null;
  try {
    if (image instanceof File && image.size > 0) {
      stored = await storeJournalPhoto(image);
    }
    await createJournalNote(prisma, {
      bedId: typeof bedId === "string" && bedId ? bedId : null,
      column: typeof columnRaw === "string" && columnRaw ? Number(columnRaw) : null,
      row: typeof rowRaw === "string" && rowRaw ? Number(rowRaw) : null,
      body: typeof body === "string" ? body : null,
      photoFilename: stored?.filename ?? null,
      photoMimeType: stored?.mimeType ?? null,
    });
    return { ok: true };
  } catch (error) {
    if (stored) await removeJournalPhoto(stored.filename);
    return { ok: false, error: describeJournalError(error) };
  }
}

export async function getSeasonRecapAction(sinceIso: string, untilIso: string): Promise<SeasonRecap | null> {
  const since = new Date(sinceIso);
  const until = new Date(untilIso);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since > until) {
    return null;
  }
  await catchUpGrowth(prisma, { weatherSource: "REAL_API" });
  return getSeasonRecap(prisma, { since, until });
}

// Trends tab — yield-over-time chart. Unlike getSeasonRecapAction, this
// deliberately skips catchUpGrowth: HarvestRecord rows are only ever written
// by recordHarvestAction (a real user action), never by the growth engine,
// so there is nothing for a catch-up pass to produce here. Every other read
// action on this page (garden snapshot on page.tsx, any onChanged refresh)
// already keeps the simulation current, so re-running the whole
// findMany-plantings + pest/predator/disease pipeline on every Trends
// "Generate" click was pure overhead — and TrendsPanel fires this alongside
// getWeatherTrendAction via Promise.all, so it used to double that cost on
// every click.
export async function getYieldTrendAction(input: {
  sinceIso: string;
  untilIso: string;
  bedId?: string;
  plantId?: string;
}): Promise<YieldTrendPoint[] | null> {
  const since = new Date(input.sinceIso);
  const until = new Date(input.untilIso);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since > until) {
    return null;
  }
  return getYieldTrend(prisma, { since, until, bedId: input.bedId, plantId: input.plantId });
}

// Trends tab — weather-trends chart. Weather has no per-bed dimension (one
// simulated location for the whole garden), so no bedId/plantId filter here.
// Also deliberately skips catchUpGrowth (see getYieldTrendAction's comment
// above) — getWeatherRangeView's own contract already treats a missing day
// as "omit it, don't gap-fill" (weather-service.ts), and by the time this
// tab is reachable the page load / any prior onChanged refresh has already
// caught the simulation up through today.
export async function getWeatherTrendAction(sinceIso: string, untilIso: string): Promise<WeatherDayView[] | null> {
  const since = new Date(sinceIso);
  const until = new Date(untilIso);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since > until) {
    return null;
  }
  return getWeatherRangeView(prisma, since, until);
}

export interface StartNewSeasonResult extends ActionResult {
  cellsCleared?: number;
  plantingsClosed?: number;
  infectionsResolved?: number;
  seasonStartedAtIso?: string;
}

function describeSeasonResetError(error: unknown): string {
  console.error("[SEASON] unexpected season reset error:", error);
  return "Something went wrong. Please try again.";
}

// The one entry point for SeasonBoundary (src/domain/season/season-reset-service.ts)
// — closes out active plantings/disease episodes via their existing
// removedAt/resolvedAt fields, resets simulation/equipment live state, and
// stamps a new season boundary. Never deletes journal/history rows.
export async function startNewSeasonAction(note?: string): Promise<StartNewSeasonResult> {
  try {
    const summary = await startNewSeason(prisma, { note: typeof note === "string" ? note : undefined });
    return {
      ok: true,
      cellsCleared: summary.cellsCleared,
      plantingsClosed: summary.plantingsClosed,
      infectionsResolved: summary.infectionsResolved,
      seasonStartedAtIso: summary.seasonStartedAt.toISOString(),
    };
  } catch (error: unknown) {
    return { ok: false, error: describeSeasonResetError(error) };
  }
}
