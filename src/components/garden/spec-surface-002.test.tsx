import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupAttentionCells, summarizeBed } from "./bed-summary";
import { NeedsAttentionBanner } from "./NeedsAttentionBanner";
import type { SnapshotBed } from "./types";

// Traces to SPEC-SURFACE-002 (extends SPEC-SURFACE-001's deferred
// disease/pest visibility "Phase B"): surfacing *why* a cell is flagged
// (dominantStressDial), grouping the flat attention list by cause, and the
// per-cell RemedyDialog that shows real-world steps plus, only where one
// genuinely exists, an in-app fix.

vi.mock("@/app/actions", () => ({
  waterCellAction: vi.fn(),
  installConditionOverrideAction: vi.fn(),
  applyFertilizerAction: vi.fn(),
  applyFungicideAction: vi.fn(),
}));

import { waterCellAction } from "@/app/actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

interface GrowthCellOptions {
  column: number;
  row: number;
  dominantStressDial: string | null;
  infectionSeverity?: number;
}

// Minimal growth shape — same convention spec-journal-001.test.tsx's
// stressedBed fixture uses (only the fields healthBand()/dominantStressDial
// actually read), cast through `unknown` rather than satisfying the full
// GrowthView shape.
function growthCell(options: GrowthCellOptions) {
  return {
    column: options.column,
    row: options.row,
    status: "GROWING",
    plantIds: ["plant-1"],
    plantings: [
      {
        growth: {
          phenologyStage: "VEGETATIVE",
          cumulativeStress: 0.8,
          waterContentIndex: 1,
          dominantStressDial: options.dominantStressDial,
        },
        infections: options.infectionSeverity != null ? [{ severity: options.infectionSeverity }] : [],
      },
    ],
    environment: null,
  };
}

function bedFixture(cells: ReturnType<typeof growthCell>[]): SnapshotBed {
  return {
    id: "bed-1",
    name: "Left Bed",
    widthFt: 4,
    lengthFt: 8,
    gridCols: 4,
    gridRows: 8,
    compassPosition: "SOUTH",
    cells,
    equipment: [],
    pests: [],
    predators: [],
    soilProfile: null,
  } as unknown as SnapshotBed;
}

function renderBanner(
  bed: SnapshotBed,
  overrides: Partial<{ onRefresh: () => Promise<void>; onOpenIrrigationSettings: () => void }> = {},
) {
  return render(
    <NeedsAttentionBanner
      beds={[bed]}
      plants={[]}
      onSelectCell={vi.fn()}
      onRefresh={overrides.onRefresh ?? vi.fn()}
      onOpenIrrigationSettings={overrides.onOpenIrrigationSettings ?? vi.fn()}
    />,
  );
}

describe("bed-summary — attention cell dial/infection passthrough", () => {
  it("carries dominantStressDial and hasActiveInfection onto each AttentionCell", () => {
    const bed = bedFixture([
      growthCell({ column: 1, row: 1, dominantStressDial: "drought" }),
      growthCell({ column: 2, row: 1, dominantStressDial: "pestDisease", infectionSeverity: 0.5 }),
    ]);
    const stats = summarizeBed(bed);
    expect(stats.attentionCells).toHaveLength(2);
    expect(stats.attentionCells[0]).toMatchObject({ dominantStressDial: "drought", hasActiveInfection: false });
    expect(stats.attentionCells[1]).toMatchObject({ dominantStressDial: "pestDisease", hasActiveInfection: true });
  });
});

describe("groupAttentionCells", () => {
  it("clusters cells by dominant dial and tags the group actionable when a remedy exists", () => {
    const bed = bedFixture([
      growthCell({ column: 1, row: 1, dominantStressDial: "drought" }),
      growthCell({ column: 2, row: 1, dominantStressDial: "drought" }),
      growthCell({ column: 3, row: 1, dominantStressDial: "cold" }),
    ]);
    const groups = groupAttentionCells(summarizeBed(bed).attentionCells);
    const drought = groups.find((group) => group.key === "drought");
    const cold = groups.find((group) => group.key === "cold");
    expect(drought?.cells).toHaveLength(2);
    expect(drought?.actionable).toBe(true);
    expect(cold?.cells).toHaveLength(1);
    expect(cold?.actionable).toBe(false);
  });

  it("marks a pestDisease group actionable when at least one cell in it has an active infection", () => {
    const bed = bedFixture([
      growthCell({ column: 1, row: 1, dominantStressDial: "pestDisease", infectionSeverity: 0.5 }),
      growthCell({ column: 2, row: 1, dominantStressDial: "pestDisease" }),
    ]);
    const groups = groupAttentionCells(summarizeBed(bed).attentionCells);
    const pestDisease = groups.find((group) => group.key === "pestDisease");
    expect(pestDisease?.cells).toHaveLength(2);
    expect(pestDisease?.actionable).toBe(true);
  });
});

describe("NeedsAttentionBanner — grouped rendering", () => {
  it("renders a group heading with a count and a fixable-now tag for an actionable dial", () => {
    const bed = bedFixture([
      growthCell({ column: 1, row: 1, dominantStressDial: "drought" }),
      growthCell({ column: 2, row: 1, dominantStressDial: "drought" }),
    ]);
    renderBanner(bed);
    fireEvent.click(screen.getByRole("button", { name: /needs attention/i }));
    expect(screen.getByText(/drought stress \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText(/fixable now/i)).toBeInTheDocument();
  });

  it("tags a non-actionable group as having no in-app fix", () => {
    const bed = bedFixture([growthCell({ column: 1, row: 1, dominantStressDial: "cold" })]);
    renderBanner(bed);
    fireEvent.click(screen.getByRole("button", { name: /needs attention/i }));
    expect(screen.getByText(/cold stress \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/no in-app fix/i)).toBeInTheDocument();
  });
});

describe("NeedsAttentionBanner — RemedyDialog", () => {
  it("opens the remedy dialog and applies the matching action for an actionable cell", async () => {
    vi.mocked(waterCellAction).mockResolvedValue({ ok: true });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const bed = bedFixture([growthCell({ column: 1, row: 1, dominantStressDial: "drought" })]);
    renderBanner(bed, { onRefresh });
    fireEvent.click(screen.getByRole("button", { name: /needs attention/i }));
    fireEvent.click(screen.getByRole("button", { name: /view fix/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /water this cell now/i }));

    await waitFor(() => expect(waterCellAction).toHaveBeenCalledWith({ bedId: "bed-1", column: 1, row: 1 }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows steps with no action button for a cell with no in-app fix", () => {
    const bed = bedFixture([growthCell({ column: 1, row: 1, dominantStressDial: "wind" })]);
    renderBanner(bed);
    fireEvent.click(screen.getByRole("button", { name: /needs attention/i }));
    fireEvent.click(screen.getByRole("button", { name: /view fix/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/no in-app fix for this/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /got it/i })).toBeInTheDocument();
  });

  it("navigates to Irrigation Settings instead of calling a server action for overwater", () => {
    const onOpenIrrigationSettings = vi.fn();
    const bed = bedFixture([growthCell({ column: 1, row: 1, dominantStressDial: "overwater" })]);
    renderBanner(bed, { onOpenIrrigationSettings });
    fireEvent.click(screen.getByRole("button", { name: /needs attention/i }));
    fireEvent.click(screen.getByRole("button", { name: /view fix/i }));

    fireEvent.click(screen.getByRole("button", { name: /open irrigation settings/i }));

    expect(onOpenIrrigationSettings).toHaveBeenCalledTimes(1);
    expect(waterCellAction).not.toHaveBeenCalled();
  });
});
