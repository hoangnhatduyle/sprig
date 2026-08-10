import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CellPicker } from "./CellPicker";
import type { SelectedCell } from "./types";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-GROWTH-004.yaml
// UI-level coverage for GrowthReadout's new progress-to-next-stage meter and
// estimated-height readout. Fixture shape mirrors spec-surface-001.test.tsx's
// baseCell(), extended with the 5 GDD fields SPEC-GROWTH-004 adds to
// PlantingGrowthView.

afterEach(() => {
  cleanup();
});

function baseCell(overrides: Partial<SelectedCell> = {}): SelectedCell {
  return {
    bedId: "bed-1",
    bedName: "North Bed",
    column: 1,
    row: 1,
    status: "GROWING",
    plantIds: ["plant-tomato"],
    plantings: [
      {
        id: "planting-1",
        plantId: "plant-tomato",
        harvestCount: 0,
        infections: [],
        companionEffects: [],
        growth: {
          phenologyStage: "VEGETATIVE",
          leafFraction: 0.4,
          stemFraction: 0.3,
          rootFraction: 0.2,
          flowerFraction: 0,
          fruitFraction: 0,
          waterContentIndex: 0.9,
          cumulativeStress: 0.1,
          dominantStressDial: null,
          growthHabit: "UPRIGHT_BUSH",
          primaryColor: "#5e9c4f",
          matureHeightCm: 150,
          accumulatedGdd: 200,
          gddToVegetative: 100,
          gddToFlowering: 300,
          gddToFruiting: 600,
          gddToMaturity: 900,
          micronutrientIndexFraction: 0.7,
          infection: null,
        },
      },
    ],
    environment: null,
    ...overrides,
  };
}

function renderCellPicker(cell: SelectedCell) {
  const result = render(
    <CellPicker
      cell={cell}
      plants={[{ id: "plant-tomato", commonName: "Tomato" }]}
      isOpen={false}
      isSubmitting={false}
      onOpen={vi.fn()}
      onAssign={vi.fn()}
      onAddCompanion={vi.fn()}
      onCancel={vi.fn()}
      onDeselect={vi.fn()}
      error={null}
    />,
  );
  // GrowthReadout lives inside the collapsible "Growth" section, which is
  // open by default — no click needed to reach its content.
  return result;
}

describe("SPEC-GROWTH-004 — GrowthReadout progress + height estimate", () => {
  it("T-SPEC-GROWTH-004-AC-AC_1: shows a progress-to-FLOWERING meter for a VEGETATIVE planting between thresholds", () => {
    renderCellPicker(baseCell());

    const progressBar = screen.getByRole("progressbar", { name: /progress to flowering/i });
    const value = Number(progressBar.getAttribute("value"));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });

  it("T-SPEC-GROWTH-004-AC-AC_2: shows an estimated current height clearly labeled as an estimate", () => {
    renderCellPicker(baseCell());

    const estimateText = screen.getByText(/of an expected 150cm/i);
    expect(estimateText).toBeInTheDocument();
    expect(estimateText.textContent).toMatch(/estimate/i);
  });

  it("T-SPEC-GROWTH-004-AC-AC_3: renders without the new fields (and without crashing) when growth is null", () => {
    const cell = baseCell({
      plantings: [
        {
          ...baseCell().plantings![0],
          growth: null,
        },
      ],
    });

    expect(() => renderCellPicker(cell)).not.toThrow();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/estimate/i)).not.toBeInTheDocument();
  });

  it.each(["MATURE", "SENESCENT"] as const)(
    "T-SPEC-GROWTH-004-AC-AC_4: shows 'Fully grown' instead of a broken/negative/NaN progress meter when phenologyStage is %s",
    (phenologyStage) => {
      const cell = baseCell({
        plantings: [
          {
            ...baseCell().plantings![0],
            growth: { ...baseCell().plantings![0].growth!, phenologyStage },
          },
        ],
      });

      renderCellPicker(cell);

      expect(screen.getByText(/fully grown/i)).toBeInTheDocument();
      expect(screen.queryByRole("progressbar", { name: /progress to/i })).not.toBeInTheDocument();
    },
  );
});
