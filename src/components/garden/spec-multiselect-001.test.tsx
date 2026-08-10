import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GardenGrid } from "./GardenGrid";
import { BulkActionBar, type BulkTarget } from "./BulkActionBar";
import type { SnapshotBed } from "./types";

// Multi-cell selection (BulkActionBar.tsx) and the GardenGrid overlay that
// renders it. Covers: select-mode highlight rendering, that GardenGrid never
// owns the toggle decision itself (it just forwards clicks), and each bulk
// action's happy path + a partial-failure case, mirroring the existing
// spec-surface-001.test.tsx conventions for this directory.

vi.mock("@/app/actions", () => ({
  assignInventoryPlantAction: vi.fn(),
  applyWeedingAction: vi.fn(),
  waterCellAction: vi.fn(),
  overridePlantingStageAction: vi.fn(),
  recordHarvestAction: vi.fn(),
  createJournalNoteAction: vi.fn(),
}));

import {
  applyWeedingAction,
  assignInventoryPlantAction,
  createJournalNoteAction,
  overridePlantingStageAction,
  recordHarvestAction,
  waterCellAction,
} from "@/app/actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function bedFixture(overrides: Partial<SnapshotBed> = {}): SnapshotBed {
  return {
    id: "bed-1",
    name: "North Bed",
    gridCols: 2,
    gridRows: 1,
    cells: [
      { column: 1, row: 1, status: "EMPTY", plantIds: [], environment: null, plantings: [] },
      {
        column: 2,
        row: 1,
        status: "GROWING",
        plantIds: ["plant-tomato"],
        environment: null,
        plantings: [{ id: "planting-1", plantId: "plant-tomato", harvestCount: 0, infections: [], companionEffects: [], growth: null }],
      },
    ],
    equipment: [],
    pests: [],
    predators: [],
    soilProfile: null,
    ...overrides,
  };
}

describe("GardenGrid — multi-select overlay", () => {
  it("marks a selected cell aria-pressed=true and an unselected cell aria-pressed=false", () => {
    render(
      <GardenGrid
        beds={[bedFixture()]}
        plants={[]}
        selectedCell={null}
        onCellClick={vi.fn()}
        selectMode
        selectedCellKeys={new Set(["bed-1:1:1"])}
      />,
    );
    const cellButtons = screen.getAllByRole("button", { name: /column \d, row 1/i });
    expect(cellButtons[0]).toHaveAttribute("aria-pressed", "true");
    expect(cellButtons[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("still routes clicks through onCellClick in select mode — toggling is the caller's job, not GardenGrid's", () => {
    const onCellClick = vi.fn();
    render(
      <GardenGrid
        beds={[bedFixture()]}
        plants={[]}
        selectedCell={null}
        onCellClick={onCellClick}
        selectMode
        selectedCellKeys={new Set()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /column 1, row 1/i }));
    expect(onCellClick).toHaveBeenCalledTimes(1);
  });
});

const TARGETS: BulkTarget[] = [
  { bedId: "bed-1", bedName: "North Bed", column: 1, row: 1, primaryCellPlantingId: null },
  { bedId: "bed-1", bedName: "North Bed", column: 2, row: 1, primaryCellPlantingId: "planting-1" },
];

describe("BulkActionBar — water action", () => {
  it("calls waterCellAction once per selected cell and reports a full-success summary", async () => {
    vi.mocked(waterCellAction).mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<BulkActionBar targets={TARGETS} plants={[]} disabled={false} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Water" }));
    fireEvent.click(screen.getByRole("button", { name: /water 2 cells/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Water: 2/2 cells updated."));
    expect(waterCellAction).toHaveBeenCalledTimes(2);
    expect(waterCellAction).toHaveBeenCalledWith({ bedId: "bed-1", column: 1, row: 1 });
    expect(waterCellAction).toHaveBeenCalledWith({ bedId: "bed-1", column: 2, row: 1 });
  });
});

describe("BulkActionBar — plant action", () => {
  it("calls assignInventoryPlantAction with mode 'replace' for every selected cell", async () => {
    vi.mocked(assignInventoryPlantAction).mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(
      <BulkActionBar targets={TARGETS} plants={[{ id: "plant-basil", commonName: "Basil" }]} disabled={false} onDone={onDone} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Plant" }));
    fireEvent.click(screen.getByRole("button", { name: /plant in 2 cells/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(assignInventoryPlantAction).toHaveBeenCalledWith({
      bedId: "bed-1",
      column: 1,
      row: 1,
      plantId: "plant-basil",
      amount: 1,
      mode: "replace",
    });
  });
});

describe("BulkActionBar — weeding action", () => {
  it("calls applyWeedingAction for every selected cell", async () => {
    vi.mocked(applyWeedingAction).mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<BulkActionBar targets={TARGETS} plants={[]} disabled={false} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Weed" }));
    fireEvent.click(screen.getByRole("button", { name: /weed 2 cells/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Weed: 2/2 cells updated."));
    expect(applyWeedingAction).toHaveBeenCalledTimes(2);
  });
});

describe("BulkActionBar — journal note action", () => {
  it("posts the same note body to every selected cell via FormData", async () => {
    vi.mocked(createJournalNoteAction).mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<BulkActionBar targets={TARGETS} plants={[]} disabled={false} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Journal note" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Mulched today" } });
    fireEvent.click(screen.getByRole("button", { name: /add note to 2 cells/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("Journal note: 2/2 cells updated."));
    expect(createJournalNoteAction).toHaveBeenCalledTimes(2);
    const firstCallFormData = vi.mocked(createJournalNoteAction).mock.calls[0][0] as FormData;
    expect(firstCallFormData.get("body")).toBe("Mulched today");
    expect(firstCallFormData.get("bedId")).toBe("bed-1");
  });
});

describe("BulkActionBar — growth stage action with a partial failure", () => {
  it("skips a cell with no active planting and reports it as a failure in the summary", async () => {
    vi.mocked(overridePlantingStageAction).mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<BulkActionBar targets={TARGETS} plants={[]} disabled={false} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Growth stage" }));
    fireEvent.click(screen.getByRole("button", { name: /apply to 2 cells/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [message] = vi.mocked(onDone).mock.calls[0];
    expect(message).toMatch(/1\/2 succeeded — 1 failed/);
    // Only the cell WITH an active planting reaches the server action.
    expect(overridePlantingStageAction).toHaveBeenCalledTimes(1);
    expect(overridePlantingStageAction).toHaveBeenCalledWith({ cellPlantingId: "planting-1", targetStage: "VEGETATIVE" });
  });
});

describe("BulkActionBar — harvest action with a partial failure", () => {
  it("skips a cell with no active planting and reports it as a failure in the summary", async () => {
    vi.mocked(recordHarvestAction).mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<BulkActionBar targets={TARGETS} plants={[]} disabled={false} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Harvest" }));
    fireEvent.click(screen.getByRole("button", { name: /harvest 2 cells/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [message] = vi.mocked(onDone).mock.calls[0];
    expect(message).toMatch(/1\/2 succeeded — 1 failed/);
    expect(recordHarvestAction).toHaveBeenCalledWith({ cellPlantingId: "planting-1", amount: 1, unit: "oz" });
  });
});
