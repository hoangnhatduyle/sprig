"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import dynamic from "next/dynamic";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  advancePlantingAction,
  applyCompostAction,
  applyFertilizerAction,
  applyFungicideAction,
  applyMulchAction,
  assignInventoryPlantAction,
  applyWeedingAction,
  createJournalNoteAction,
  recordHarvestAction,
  refreshWorkspaceAction,
  removePlantingAction,
  type ActionResult,
  type CellTarget,
  type InventoryAssignmentTarget,
  type WorkspaceSnapshot,
} from "@/app/actions";
import type { GardenJournal } from "@/domain/journal/journal-service";
import type { InventoryPlant, InventorySnapshot } from "@/domain/plant-catalog/inventory-service";
import { isTransitionAllowed, nextPickerState, type PickerEvent } from "@/domain/plant-ui/picker-interaction";
import { CellPicker } from "./CellPicker";
import { GardenGrid } from "./GardenGrid";
import { GardenSummary } from "./GardenSummary";
import { GardenTopTabs } from "./GardenTopTabs";
import { NeedsAttentionBanner } from "./NeedsAttentionBanner";
import { RainBarrelPanel } from "./RainBarrelPanel";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import type {
  GardenEnvironment,
  PlantOption,
  SelectedCell,
  SnapshotBed,
  SnapshotCell,
  SnapshotRainBarrel,
} from "./types";

// three.js + @react-three/fiber + @react-three/drei (plus the ~7.5MB GLB
// model GardenScene3D preloads) are heavy enough that a static import put
// them on the critical path for every page load, whether or not anyone
// scrolls to the 3D panel — code-split via next/dynamic so the 2D grid
// (the primary, always-needed workflow) hydrates and becomes interactive
// without waiting on that chunk. ssr: false because the canvas needs real
// WebGL/browser APIs; GardenViewer3D's own useWebGlSupport() check already
// handles the "no WebGL" case once the chunk does load.
const GardenViewer3D = dynamic(
  () => import("@/components/garden-3d/GardenViewer3D").then((mod) => mod.GardenViewer3D),
  {
    ssr: false,
    loading: () => (
      <div
        className="aspect-[4/3] w-full animate-pulse rounded-xl border xl:aspect-[3/2] 2xl:aspect-[5/4]"
        style={{ borderColor: "var(--color-border)", background: "var(--color-scene-bg)" }}
      />
    ),
  },
);

export interface GardenViewProps {
  initialBeds: SnapshotBed[];
  initialEnvironment: GardenEnvironment;
  initialRainBarrels?: SnapshotRainBarrel[];
  initialPlants: PlantOption[];
  initialInventory?: InventorySnapshot;
  initialJournal?: GardenJournal;
  assignInventoryPlant?: (target: InventoryAssignmentTarget) => Promise<ActionResult>;
  removePlanting?: (target: CellTarget) => Promise<ActionResult>;
  refreshWorkspace?: () => Promise<WorkspaceSnapshot>;
}

// Couples pickerState and its target cell into one value so the two can
// never drift apart. Previously they were two independent useState slots:
// Cancel reset pickerState to IDLE but left selectedCell populated, so the
// "open picker" button reappeared but silently no-opped (open_picker isn't
// a valid transition from IDLE) until the user re-clicked a grid cell.
type PickerUiState =
  | { status: "IDLE" }
  | { status: "CELL_SELECTED"; cell: SelectedCell }
  | { status: "PICKER_OPEN"; cell: SelectedCell };

type PickerUiAction =
  | { type: "click_cell"; cell: SelectedCell }
  | { type: "open_picker" }
  | { type: "select_plant"; cell: SelectedCell }
  | { type: "cancel" }
  | { type: "deselect" };

function sameCell(a: SelectedCell, b: SelectedCell): boolean {
  return a.bedId === b.bedId && a.column === b.column && a.row === b.row;
}

function pickerUiReducer(state: PickerUiState, action: PickerUiAction): PickerUiState {
  if (action.type === "click_cell") {
    // Selecting a (possibly different) cell always starts a fresh
    // selection — not itself gated by the FSM below, since "select another
    // cell while one is already selected" isn't a modeled transition; only
    // IDLE -[click_cell]-> CELL_SELECTED is (see picker-interaction.ts).
    return { status: "CELL_SELECTED", cell: action.cell };
  }
  if (state.status === "IDLE") {
    return state;
  }
  if (action.type === "select_plant" && !sameCell(state.cell, action.cell)) {
    // A mutation that was in flight against a cell the user has since
    // navigated away from — its late completion must not clobber whatever
    // is currently selected.
    return state;
  }
  const event: PickerEvent = action.type;
  if (!isTransitionAllowed(state.status, event)) {
    return state;
  }
  const next = nextPickerState(state.status, event);
  return next === "IDLE" ? { status: "IDLE" } : { status: next, cell: state.cell };
}

export function GardenView({
  initialBeds,
  initialEnvironment,
  initialRainBarrels,
  initialPlants,
  initialInventory,
  initialJournal,
  assignInventoryPlant = assignInventoryPlantAction,
  removePlanting = removePlantingAction,
  refreshWorkspace = refreshWorkspaceAction,
}: GardenViewProps) {
  const [beds, setBeds] = useState<SnapshotBed[]>(initialBeds);
  const [environment, setEnvironment] = useState<GardenEnvironment>(initialEnvironment);
  const [rainBarrels, setRainBarrels] = useState<SnapshotRainBarrel[]>(initialRainBarrels ?? []);
  const [inventory, setInventory] = useState<InventorySnapshot>(
    initialInventory ?? { seeds: initialPlants as InventoryPlant[], yields: [] },
  );
  const plants = initialInventory ? inventory.seeds : initialPlants;
  const [picker, dispatch] = useReducer(pickerUiReducer, { status: "IDLE" });
  // Rain barrels moved from an always-visible banner (which pushed the drag-
  // and-drop bed grid down, getting in the way when dropping seeds from
  // inventory) into a tab alongside the bed layout instead — the 3D viewer
  // deliberately stays outside this tab switch and always shows the whole
  // garden, same as it already ignores whether the picker or summary is
  // showing in this same left-column slot.
  const [leftTab, setLeftTab] = useState<"bedLayout" | "rainBarrels">("bedLayout");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const lastFocusedCellRef = useRef<HTMLButtonElement | null>(null);
  const pickerPanelRef = useRef<HTMLDivElement | null>(null);
  // A native `.focus()` call on a still-`disabled` button is silently
  // ignored by the browser. Since the grid's `disabled={isSubmitting}` only
  // clears after React commits the post-mutation re-render, requesting
  // focus return has to be deferred to an effect that fires once
  // `isSubmitting` has actually gone false and the DOM reflects it — not
  // called inline in the same tick `setIsSubmitting(false)` runs.
  const pendingFocusReturn = useRef(false);
  const [activeDrag, setActiveDrag] = useState<InventoryPlant | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{
    plant: InventoryPlant;
    bed: SnapshotBed;
    cell: SnapshotCell;
  } | null>(null);
  const [dropAmount, setDropAmount] = useState("1");
  const [dropMode, setDropMode] = useState<"replace" | "companion">("replace");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const selectedCell = picker.status === "IDLE" ? null : picker.cell;

  useEffect(() => {
    if (!isSubmitting && pendingFocusReturn.current) {
      pendingFocusReturn.current = false;
      lastFocusedCellRef.current?.focus();
    }
  }, [isSubmitting]);

  useEffect(() => {
    // jsdom (used by the component test suite) doesn't implement
    // scrollIntoView — feature-detect rather than assume a real browser.
    if (selectedCell && typeof pickerPanelRef.current?.scrollIntoView === "function") {
      pickerPanelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedCell]);

  // Shared by both views' click handlers so 2D and 3D can never select a cell
  // through two different code paths - a click anywhere always produces the
  // same SelectedCell shape and goes through the same reducer transition.
  function selectCell(target: SelectedCell): void {
    setError(null);
    setStatusMessage(null);
    dispatch({ type: "click_cell", cell: target });
  }

  function handleCellClick(bed: SnapshotBed, cell: SnapshotCell, event: React.MouseEvent<HTMLButtonElement>): void {
    lastFocusedCellRef.current = event.currentTarget;
    selectCell({
      bedId: bed.id,
      bedName: bed.name,
      column: cell.column,
      row: cell.row,
      status: cell.status,
      plantIds: cell.plantIds,
      plantings: cell.plantings,
      environment: cell.environment,
      soilProfile: bed.soilProfile,
    });
  }

  // The 3D view resolves its own click target (garden-3d-adapter.ts, from the
  // same `beds` state this component already holds) before calling this -
  // by the time it lands here it's an ordinary SelectedCell, same as a 2D
  // click. No focus-return ref to set: unlike a grid <button>, there's no
  // DOM element in the 3D scene worth returning keyboard focus to.
  function handleCellClick3D(target: SelectedCell): void {
    selectCell(target);
  }

  function handleOpenPicker(): void {
    dispatch({ type: "open_picker" });
  }

  function handleCancel(): void {
    dispatch({ type: "cancel" });
    setError(null);
    setStatusMessage(null);
    lastFocusedCellRef.current?.focus();
  }

  function handleDeselect(): void {
    dispatch({ type: "deselect" });
    setError(null);
    setStatusMessage(null);
    lastFocusedCellRef.current?.focus();
  }

  // Shared by the "Assign"/"Replace with" and "Add companion" plant lists —
  // both go through assignInventoryPlantAction (mode "replace" vs
  // "companion") rather than GRID's bare assignPlant/addCompanionPlant, so
  // a click here checks and spends inventory stock exactly like a
  // drag-and-drop from the inventory panel does (confirmDrop below). One
  // unit is spent per click — there's no amount prompt in the picker's
  // one-click flow the way the drag-and-drop confirmation dialog has one.
  async function applyInventoryAssignment(
    plantId: string,
    mode: "replace" | "companion",
    successVerb: string,
  ): Promise<void> {
    if (!selectedCell || isSubmitting) {
      return;
    }
    const target = selectedCell;
    const plant = plants.find((item) => item.id === plantId);
    const available = plant?.seedQuantity ?? 0;
    if (available <= 0) {
      setError(`No ${plant?.commonName ?? "seed"} stock left — add more in Inventory first.`);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      let result: ActionResult;
      try {
        result = await assignInventoryPlant({
          bedId: target.bedId,
          column: target.column,
          row: target.row,
          plantId,
          amount: Math.min(1, available),
          mode,
        });
      } catch {
        // The Server Action call itself rejected at the transport level
        // (network drop, server restart) — distinct from
        // assignInventoryPlantAction returning `{ ok: false }` for a domain
        // error (e.g. insufficient stock), which is handled below.
        setError("Couldn't reach the server. Check your connection and try again.");
        return;
      }
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      try {
        // refreshAll, not just refreshSnapshot — this mutation also spends
        // inventory stock, so the seed counts shown elsewhere in the UI
        // must refresh alongside the grid.
        await refreshAll();
      } catch {
        // The mutation itself already succeeded — say so, rather than
        // implying it failed, while still surfacing that the view is stale.
        setError("Saved, but the garden view failed to refresh. Reload the page to see the latest state.");
        return;
      }
      setStatusMessage(
        `${plant?.commonName ?? "Plant"} ${successVerb} ${target.bedName}, column ${target.column}, row ${target.row}.`,
      );
      pendingFocusReturn.current = true;
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleAssign(plantId: string): void {
    void applyInventoryAssignment(plantId, "replace", "assigned to");
  }

  function handleAddCompanion(plantId: string): void {
    void applyInventoryAssignment(plantId, "companion", "added as a companion to");
  }

  async function applyRemoval(plantId: string): Promise<void> {
    if (!selectedCell || isSubmitting) {
      return;
    }
    const target = selectedCell;
    const name = plants.find((item) => item.id === plantId)?.commonName ?? "Plant";
    setIsSubmitting(true);
    setError(null);
    try {
      let result: ActionResult;
      try {
        result = await removePlanting({ bedId: target.bedId, column: target.column, row: target.row, plantId });
      } catch {
        setError("Couldn't reach the server. Check your connection and try again.");
        return;
      }
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      try {
        await refreshAll();
      } catch {
        setError("Removed, but the garden view failed to refresh. Reload the page to see the latest state.");
        return;
      }
      setStatusMessage(`${name} removed from ${target.bedName}, column ${target.column}, row ${target.row}.`);
      pendingFocusReturn.current = true;
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleRemovePlant(plantId: string): void {
    void applyRemoval(plantId);
  }

  async function refreshAll(): Promise<void> {
    const snapshot = await refreshWorkspace();
    setBeds(snapshot.garden.beds);
    setEnvironment(snapshot.garden.environment);
    setRainBarrels(snapshot.garden.rainBarrels);
    setInventory(snapshot.inventory);
    if (selectedCell) {
      const bed = snapshot.garden.beds.find((item) => item.id === selectedCell.bedId);
      const cell = bed?.cells.find(
        (item) => item.column === selectedCell.column && item.row === selectedCell.row,
      );
      if (bed && cell) {
        dispatch({
          type: "click_cell",
          cell: {
            bedId: bed.id,
            bedName: bed.name,
            column: cell.column,
            row: cell.row,
            status: cell.status,
            plantIds: cell.plantIds,
            plantings: cell.plantings,
            environment: cell.environment,
          },
        });
      }
    }
  }

  function handleDragStart(event: DragStartEvent): void {
    setActiveDrag((event.active.data.current?.plant as InventoryPlant | undefined) ?? null);
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveDrag(null);
    const plant = event.active.data.current?.plant as InventoryPlant | undefined;
    const target = event.over?.data.current as { bed?: SnapshotBed; cell?: SnapshotCell } | undefined;
    if (!plant || !target?.bed || !target.cell) return;
    setDropAmount(String(Math.min(1, plant.seedQuantity)));
    setDropMode("replace");
    setPendingDrop({ plant, bed: target.bed, cell: target.cell });
  }

  async function confirmDrop(): Promise<void> {
    if (!pendingDrop || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const { plant, bed, cell } = pendingDrop;
    try {
      const result = await assignInventoryPlantAction({
        bedId: bed.id,
        column: cell.column,
        row: cell.row,
        plantId: plant.id,
        amount: Number(dropAmount),
        mode: cell.plantIds.length > 0 ? dropMode : "replace",
      });
      if (!result.ok) {
        setError(result.error ?? "Couldn't assign that plant.");
        return;
      }
      await refreshAll();
      setPendingDrop(null);
      setStatusMessage(`${plant.commonName} planted in ${bed.name}, column ${cell.column}, row ${cell.row}.`);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <DndContext
      id="sprig-garden-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveDrag(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-8">
        <GardenTopTabs
          environment={environment}
          inventory={inventory}
          beds={beds}
          initialJournal={initialJournal}
          disabled={isSubmitting}
          onChanged={refreshAll}
        />
        <NeedsAttentionBanner beds={beds} />
    <div
      data-testid="garden-workspace"
      className="flex flex-col gap-8 xl:grid xl:grid-cols-[minmax(0,7fr)_minmax(30rem,13fr)] xl:items-start xl:gap-8 2xl:gap-10"
    >
      <div className="@container flex min-w-0 flex-col gap-5 sm:gap-6">
        <div role="tablist" aria-label="Garden view" className="flex gap-2 border-b" style={{ borderColor: "var(--color-border)" }}>
          {(
            [
              { id: "bedLayout", label: "Bed Layout" },
              { id: "rainBarrels", label: "Rain Barrels" },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${id}-tab`}
              aria-selected={leftTab === id}
              aria-controls={`${id}-panel`}
              onClick={() => setLeftTab(id)}
              className={`${MIN_TOUCH_TARGET} rounded-t-md border border-b-0 px-4 text-sm font-semibold ${FOCUS_RING}`}
              style={{
                borderColor: "var(--color-border)",
                background: leftTab === id ? "var(--color-surface-raised)" : "transparent",
                color: leftTab === id ? "var(--color-text)" : "var(--color-text-muted)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div id="bedLayout-panel" role="tabpanel" aria-labelledby="bedLayout-tab" hidden={leftTab !== "bedLayout"} className="flex flex-col gap-5 sm:gap-6">
        <div role="status" aria-live="polite" className="sr-only">
          {statusMessage}
        </div>
        <GardenGrid
          beds={beds}
          plants={plants}
          selectedCell={selectedCell}
          disabled={isSubmitting}
          onCellClick={handleCellClick}
        />
        {selectedCell && (
          <div ref={pickerPanelRef} className="scroll-mt-6">
            <CellPicker
              cell={selectedCell}
              plants={plants}
              isOpen={picker.status === "PICKER_OPEN"}
              isSubmitting={isSubmitting}
              onOpen={handleOpenPicker}
              onAssign={handleAssign}
              onAddCompanion={handleAddCompanion}
              onRemovePlant={handleRemovePlant}
              onCancel={handleCancel}
              onDeselect={handleDeselect}
              error={error}
              onRefresh={refreshAll}
              recordHarvest={recordHarvestAction}
              advancePlanting={advancePlantingAction}
              applyMulch={applyMulchAction}
              applyCompost={applyCompostAction}
              applyFertilizer={applyFertilizerAction}
              applyFungicide={applyFungicideAction}
              applyWeeding={applyWeedingAction}
              createJournalNote={createJournalNoteAction}
            />
          </div>
        )}
        </div>
        <div id="rainBarrels-panel" role="tabpanel" aria-labelledby="rainBarrels-tab" hidden={leftTab !== "rainBarrels"}>
          <RainBarrelPanel rainBarrels={rainBarrels} disabled={isSubmitting} onChanged={refreshAll} />
        </div>
        {/* Outside both tabs per user request — an ambient overview
            shouldn't disappear just because you switched to Rain Barrels,
            the same way NeedsAttentionBanner is never tab-scoped either. */}
        <GardenSummary beds={beds} plants={plants} />
      </div>
      <div className="min-w-0 xl:sticky xl:top-8">
        <GardenViewer3D
          beds={beds}
          environment={environment}
          rainBarrels={rainBarrels}
          plants={plants}
          selectedCell={selectedCell}
          disabled={isSubmitting}
          onCellClick={handleCellClick3D}
        />
      </div>
    </div>
      {pendingDrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="drop-heading" className="w-full max-w-md rounded-xl border bg-[var(--color-surface-raised)] p-5 shadow-xl" style={{ borderColor: "var(--color-border)" }}>
            <h2 id="drop-heading" className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>Plant {pendingDrop.plant.commonName}</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>{pendingDrop.bed.name}, column {pendingDrop.cell.column}, row {pendingDrop.cell.row}</p>
            {pendingDrop.cell.plantIds.length > 0 && (
              <label className="mt-4 block text-sm font-medium">
                Assignment
                <select value={dropMode} onChange={(event) => setDropMode(event.target.value as "replace" | "companion")} className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3" style={{ borderColor: "var(--color-border)" }}>
                  <option value="replace">Replace current plant</option>
                  <option value="companion">Add as companion</option>
                </select>
              </label>
            )}
            <label className="mt-4 block text-sm font-medium">
              Amount consumed ({pendingDrop.plant.seedUnit})
              <input type="number" min="0.01" max={pendingDrop.plant.seedQuantity} step="any" value={dropAmount} onChange={(event) => setDropAmount(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3" style={{ borderColor: "var(--color-border)" }} />
            </label>
            {error && <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-danger-text)" }}>{error}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => void confirmDrop()} disabled={isSubmitting} className="min-h-11 rounded-md bg-[var(--color-cta-bg)] px-4 font-semibold text-[var(--color-cta-text)] disabled:opacity-50">Confirm planting</button>
              <button type="button" onClick={() => { setPendingDrop(null); setError(null); }} disabled={isSubmitting} className="min-h-11 rounded-md border px-4" style={{ borderColor: "var(--color-border)" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <DragOverlay>
        {activeDrag ? (
          <div
            className="flex items-center gap-2 rounded-lg border-2 px-2 py-2 shadow-xl"
            style={{ borderColor: "var(--color-accent)", background: "var(--color-surface-raised)" }}
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md"
              style={{ background: "var(--color-surface)" }}
            >
              {activeDrag.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- DragOverlay renders in a portal outside normal layout flow; next/image's fill mode adds no benefit here.
                <img src={activeDrag.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xl" aria-hidden="true">🌱</span>
              )}
            </span>
            <span>
              <strong className="block text-sm leading-tight">{activeDrag.commonName}</strong>
              <span className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
                {activeDrag.seedQuantity} {activeDrag.seedUnit}
              </span>
            </span>
          </div>
        ) : null}
      </DragOverlay>
      </div>
    </DndContext>
  );
}
