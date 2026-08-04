import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GardenView } from "@/components/garden/GardenView";
import type { GardenEnvironment, SnapshotBed, SnapshotCell } from "@/components/garden/types";
import type { InventoryPlant } from "@/domain/plant-catalog/inventory-service";
import { isTransitionAllowed, nextPickerState, PickerTransitionError } from "@/domain/plant-ui/picker-interaction";

// Traces to: /home/hoang/projects/Sprig/.claude/tests/SPEC-PLANTUI-001.tests.yaml
// Each `it` below is named after its harness case id so validate_coverage
// results map 1:1 back to the generated test plan.

afterEach(() => {
  cleanup();
});

function makeInventoryPlant(id: string, commonName: string, seedQuantity = 10): InventoryPlant {
  return {
    id,
    commonName,
    waterNeed: null,
    lightNeed: null,
    isCompanionPlanting: false,
    notes: null,
    seedQuantity,
    seedUnit: "seeds",
    seedsPerUnit: 1,
    unitQuantity: seedQuantity,
    imageUrl: null,
    speciesProfileId: null,
    speciesProfileName: null,
  };
}

const PLANTS: InventoryPlant[] = [makeInventoryPlant("plant-tomato", "Tomato"), makeInventoryPlant("plant-basil", "Basil")];

const TEST_ENVIRONMENT: GardenEnvironment = {
  simTimeIso: "2026-06-01T12:00:00.000Z",
  clockRate: 1,
  phase: "DAY",
  sunAltitudeRad: 0.8,
  sunAzimuthRad: 3.14,
  sunriseIso: "2026-06-01T10:00:00.000Z",
  sunsetIso: "2026-06-02T02:00:00.000Z",
  weather: null,
  forecast: [],
};

function makeCell(column: number, row: number, status: SnapshotCell["status"], plantIds: string[] = []): SnapshotCell {
  return { column, row, status, plantIds, environment: null, plantings: [] };
}

function makeBed(id: string, name: string, cells: SnapshotCell[]): SnapshotBed {
  return { id, name, gridCols: 2, gridRows: 1, cells, equipment: [], pests: [], predators: [], soilProfile: null };
}

// Builds a refreshWorkspace mock's resolved value — the picker's assign/
// companion/remove flows all refresh via refreshWorkspace (not a bare
// garden snapshot) since assignment also spends inventory stock that must
// be reflected everywhere seed counts are shown.
function workspaceSnapshot(beds: SnapshotBed[], seeds: InventoryPlant[] = PLANTS) {
  return {
    garden: { beds, environment: TEST_ENVIRONMENT, rainBarrels: [] },
    inventory: { seeds, yields: [] },
  };
}

describe("SPEC-PLANTUI-001", () => {
  it("T-SPEC-PLANTUI-001-AC-AC_1: assigns a plant to an EMPTY cell with the exact cell coordinates, spends one unit of seed stock, and updates the display", async () => {
    const beds = [makeBed("bed-1", "North Bed", [makeCell(0, 0, "EMPTY")])];
    const assignInventoryPlant = vi.fn().mockResolvedValue({ ok: true });
    const refreshWorkspace = vi
      .fn()
      .mockResolvedValue(workspaceSnapshot([makeBed("bed-1", "North Bed", [makeCell(0, 0, "PLANTED", ["plant-tomato"])])]));

    render(
      <GardenView
        initialBeds={beds}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={PLANTS}
        assignInventoryPlant={assignInventoryPlant}
        refreshWorkspace={refreshWorkspace}
      />,
    );

    fireEvent.click(screen.getByLabelText(/column 0, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /assign plant/i }));
    fireEvent.click(screen.getByRole("button", { name: "Tomato" }));

    await waitFor(() =>
      expect(assignInventoryPlant).toHaveBeenCalledWith({
        bedId: "bed-1",
        column: 0,
        row: 0,
        plantId: "plant-tomato",
        amount: 1,
        mode: "replace",
      }),
    );
    expect(refreshWorkspace).toHaveBeenCalled();
    await screen.findByLabelText(/column 0, row 0, planted, tomato/i);
  });

  it("T-SPEC-PLANTUI-001-AC-AC_2: replacing a plant on an active cell calls assignInventoryPlant (mode 'replace') and updates the display to the new plant", async () => {
    const beds = [makeBed("bed-1", "North Bed", [makeCell(0, 0, "PLANTED", ["plant-basil"])])];
    const assignInventoryPlant = vi.fn().mockResolvedValue({ ok: true });
    const refreshWorkspace = vi
      .fn()
      .mockResolvedValue(workspaceSnapshot([makeBed("bed-1", "North Bed", [makeCell(0, 0, "PLANTED", ["plant-tomato"])])]));

    render(
      <GardenView
        initialBeds={beds}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={PLANTS}
        assignInventoryPlant={assignInventoryPlant}
        refreshWorkspace={refreshWorkspace}
      />,
    );

    fireEvent.click(screen.getByLabelText(/column 0, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /change plant/i }));
    fireEvent.click(screen.getByRole("button", { name: "Tomato" }));

    await waitFor(() =>
      expect(assignInventoryPlant).toHaveBeenCalledWith({
        bedId: "bed-1",
        column: 0,
        row: 0,
        plantId: "plant-tomato",
        amount: 1,
        mode: "replace",
      }),
    );

    fireEvent.click(await screen.findByLabelText(/column 0, row 0/i));
    const cellDetails = await screen.findByRole("complementary", { name: "Cell details" });
    expect(within(cellDetails).getByText("Tomato")).toBeInTheDocument();
  });

  it("T-SPEC-PLANTUI-001-AC-AC_3: adding a companion plant calls assignInventoryPlant (mode 'companion') and the display shows both plants active", async () => {
    const beds = [makeBed("bed-1", "North Bed", [makeCell(0, 0, "PLANTED", ["plant-basil"])])];
    const assignInventoryPlant = vi.fn().mockResolvedValue({ ok: true });
    const refreshWorkspace = vi.fn().mockResolvedValue(
      workspaceSnapshot([makeBed("bed-1", "North Bed", [makeCell(0, 0, "PLANTED", ["plant-basil", "plant-tomato"])])]),
    );

    render(
      <GardenView
        initialBeds={beds}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={PLANTS}
        assignInventoryPlant={assignInventoryPlant}
        refreshWorkspace={refreshWorkspace}
      />,
    );

    fireEvent.click(screen.getByLabelText(/column 0, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /change plant/i }));
    fireEvent.click(screen.getByRole("button", { name: "+ Tomato" }));

    await waitFor(() =>
      expect(assignInventoryPlant).toHaveBeenCalledWith({
        bedId: "bed-1",
        column: 0,
        row: 0,
        plantId: "plant-tomato",
        amount: 1,
        mode: "companion",
      }),
    );

    fireEvent.click(await screen.findByLabelText(/column 0, row 0, planted, basil, tomato/i));
    const cellDetails = await screen.findByRole("complementary", { name: "Cell details" });
    expect(within(cellDetails).getByText("Basil")).toBeInTheDocument();
    expect(within(cellDetails).getByText("Tomato")).toBeInTheDocument();
  });

  it("T-SPEC-PLANTUI-001-AC-AC_4: a HARVESTED cell offers only clear/remove actions, never a direct replace-plant action", () => {
    const beds = [makeBed("bed-1", "North Bed", [makeCell(0, 0, "HARVESTED", ["plant-basil"])])];

    render(
      <GardenView
        initialBeds={beds}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={PLANTS}
        assignInventoryPlant={vi.fn()}
        refreshWorkspace={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/column 0, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /view options/i }));

    expect(screen.queryByRole("button", { name: "Tomato" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Basil" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear cell" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove cell" })).toBeInTheDocument();
  });

  it("T-SPEC-PLANTUI-001-AC-AC_5: removing a plant from an active cell calls removePlanting with that cell's exact coordinates and the cell returns to unplanted", async () => {
    const beds = [makeBed("bed-1", "North Bed", [makeCell(0, 0, "PLANTED", ["plant-tomato"])])];
    const removePlanting = vi.fn().mockResolvedValue({ ok: true });
    const refreshWorkspace = vi.fn().mockResolvedValue(workspaceSnapshot([makeBed("bed-1", "North Bed", [makeCell(0, 0, "REMOVED")])]));

    render(
      <GardenView
        initialBeds={beds}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={PLANTS}
        removePlanting={removePlanting}
        refreshWorkspace={refreshWorkspace}
      />,
    );

    fireEvent.click(screen.getByLabelText(/column 0, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /remove tomato from this cell/i }));

    await waitFor(() =>
      expect(removePlanting).toHaveBeenCalledWith({ bedId: "bed-1", column: 0, row: 0, plantId: "plant-tomato" }),
    );
    expect(refreshWorkspace).toHaveBeenCalled();
    await screen.findByLabelText(/column 0, row 0, removed/i);
  });

  it("T-SPEC-PLANTUI-001-AC-AC_6: assigning a plant is blocked with a clear message when the plant has no seed stock left", async () => {
    const beds = [makeBed("bed-1", "North Bed", [makeCell(0, 0, "EMPTY")])];
    const outOfStock = [makeInventoryPlant("plant-tomato", "Tomato", 0), makeInventoryPlant("plant-basil", "Basil", 10)];
    const assignInventoryPlant = vi.fn().mockResolvedValue({ ok: true });

    render(
      <GardenView
        initialBeds={beds}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={outOfStock}
        assignInventoryPlant={assignInventoryPlant}
        refreshWorkspace={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/column 0, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /assign plant/i }));
    fireEvent.click(screen.getByRole("button", { name: "Tomato" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no tomato stock left/i);
    expect(assignInventoryPlant).not.toHaveBeenCalled();
  });

  it("T-SPEC-PLANTUI-001-FORBID-Cell_picker_interaction_IDLE_PICKER_OPEN: rejects opening the picker without a cell selected first", () => {
    expect(isTransitionAllowed("IDLE", "open_picker")).toBe(false);
    expect(() => nextPickerState("IDLE", "open_picker")).toThrow(PickerTransitionError);
  });

  it("T-SPEC-PLANTUI-001-NC-NC_SPRIG_PLANTUI_NO_STALE_CELL_REF: keeps the picker bound to the originally clicked cell's coordinates even if the grid data is replaced underneath it", async () => {
    const beds = [makeBed("bed-1", "North Bed", [makeCell(0, 0, "EMPTY"), makeCell(1, 0, "EMPTY")])];
    const assignInventoryPlant = vi.fn().mockResolvedValue({ ok: true });
    const refreshWorkspace = vi.fn().mockResolvedValue(workspaceSnapshot(beds));

    const { rerender } = render(
      <GardenView
        initialBeds={beds}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={PLANTS}
        assignInventoryPlant={assignInventoryPlant}
        refreshWorkspace={refreshWorkspace}
      />,
    );

    // Select the SECOND cell — its exact coordinates must be preserved even
    // if a concurrent refresh replaces the underlying `beds` data (e.g. a
    // renamed bed, or cells reordered) while the picker is still open.
    fireEvent.click(screen.getByLabelText(/column 1, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /assign plant/i }));

    rerender(
      <GardenView
        initialBeds={[makeBed("bed-1", "Renamed Bed", [makeCell(1, 0, "EMPTY"), makeCell(0, 0, "EMPTY")])]}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={PLANTS}
        assignInventoryPlant={assignInventoryPlant}
        refreshWorkspace={refreshWorkspace}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tomato" }));

    await waitFor(() =>
      expect(assignInventoryPlant).toHaveBeenCalledWith({
        bedId: "bed-1",
        column: 1,
        row: 0,
        plantId: "plant-tomato",
        amount: 1,
        mode: "replace",
      }),
    );
  });

  it("does not offer 'add companion' on an EMPTY cell (NC-SPRIG-PLANTUI-NO-COMPANION-ON-EMPTY)", () => {
    const beds = [makeBed("bed-1", "North Bed", [makeCell(0, 0, "EMPTY")])];

    render(
      <GardenView
        initialBeds={beds}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={PLANTS}
        assignInventoryPlant={vi.fn()}
        refreshWorkspace={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/column 0, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /assign plant/i }));

    expect(screen.queryByText(/add companion/i)).not.toBeInTheDocument();
  });

  it("fully closes the picker on Cancel (matching the spec's PICKER_OPEN->IDLE transition) and leaves the cell reselectable, not stuck (regression)", async () => {
    const beds = [makeBed("bed-1", "North Bed", [makeCell(0, 0, "EMPTY")])];
    const assignInventoryPlant = vi.fn().mockResolvedValue({ ok: true });

    render(
      <GardenView
        initialBeds={beds}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={PLANTS}
        assignInventoryPlant={assignInventoryPlant}
        refreshWorkspace={vi.fn().mockResolvedValue(workspaceSnapshot(beds))}
      />,
    );

    fireEvent.click(screen.getByLabelText(/column 0, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /assign plant/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Cancel transitions PICKER_OPEN -> IDLE per the spec's state machine,
    // so the whole picker (including the toggle button) closes — there is
    // no stale cell reference left behind that would make a lingering
    // "Assign plant" button silently no-op on click.
    expect(screen.queryByRole("button", { name: /assign plant/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cell details")).not.toBeInTheDocument();

    // Previously: a stale selectedCell survived the IDLE reset, so a
    // *second* click on the grid cell wasn't guaranteed to fully reset
    // state either. Confirm re-selecting and reopening still works cleanly.
    fireEvent.click(screen.getByLabelText(/column 0, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /assign plant/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Tomato" }));

    await waitFor(() =>
      expect(assignInventoryPlant).toHaveBeenCalledWith({
        bedId: "bed-1",
        column: 0,
        row: 0,
        plantId: "plant-tomato",
        amount: 1,
        mode: "replace",
      }),
    );
  });

  it("disables the grid while a mutation is in flight, so a second cell can't be selected mid-submit", async () => {
    const beds = [makeBed("bed-1", "North Bed", [makeCell(0, 0, "EMPTY"), makeCell(1, 0, "EMPTY")])];
    let resolveAssign: (value: { ok: true }) => void = () => {};
    const assignInventoryPlant = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveAssign = resolve;
      }),
    );
    const refreshWorkspace = vi.fn().mockResolvedValue(workspaceSnapshot(beds));

    render(
      <GardenView
        initialBeds={beds}
        initialEnvironment={TEST_ENVIRONMENT}
        initialPlants={PLANTS}
        assignInventoryPlant={assignInventoryPlant}
        refreshWorkspace={refreshWorkspace}
      />,
    );

    fireEvent.click(screen.getByLabelText(/column 0, row 0/i));
    fireEvent.click(screen.getByRole("button", { name: /assign plant/i }));
    fireEvent.click(screen.getByRole("button", { name: "Tomato" }));

    expect(screen.getByLabelText(/column 1, row 0/i)).toBeDisabled();

    resolveAssign({ ok: true });
    await waitFor(() => expect(refreshWorkspace).toHaveBeenCalled());
    expect(screen.getByLabelText(/column 1, row 0/i)).not.toBeDisabled();
  });
});
