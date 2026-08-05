import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CellPicker } from "./CellPicker";
import { GardenGrid } from "./GardenGrid";
import { GardenSummary } from "./GardenSummary";
import { WeatherBanner } from "./WeatherBanner";
import type { GardenEnvironment, SelectedCell, SnapshotBed } from "./types";

// Traces to SPEC-SURFACE-001. Component-level coverage stays at the DOM
// level (jsdom has no WebGL, so 3D coverage lives at the pure-module/adapter
// level instead — src/domain/garden-3d/*.test.ts, garden-3d-adapter.test.ts).

afterEach(() => {
  cleanup();
});

const BASE_ENVIRONMENT: GardenEnvironment = {
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

describe("WeatherBanner", () => {
  it("shows a friendly message instead of a blank banner when weather hasn't been generated yet", () => {
    render(<WeatherBanner environment={BASE_ENVIRONMENT} />);
    expect(screen.getByText(/weather hasn't been generated yet/i)).toBeInTheDocument();
  });

  it("renders condition, temperature range, precipitation, and the source chip once weather exists", () => {
    render(
      <WeatherBanner
        environment={{
          ...BASE_ENVIRONMENT,
          weather: {
            date: new Date("2026-06-01T00:00:00.000Z"),
            condition: "RAIN",
            tempHighC: 22,
            tempLowC: 14,
            precipitationMm: 6,
            cloudCoverPct: 80,
            humidityPct: 70,
            windSpeedKph: 12,
            source: "PROCEDURAL",
            isSnowDay: false,
          },
        }}
      />,
    );
    expect(screen.getByText("Rain")).toBeInTheDocument();
    expect(screen.getByText(/14° – 22°C/)).toBeInTheDocument();
    expect(screen.getByText(/Simulated weather/i)).toBeInTheDocument();
  });
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
          cumulativeStress: 0.5,
          dominantStressDial: "pestDisease",
          growthHabit: "UPRIGHT_BUSH",
          primaryColor: "#5e9c4f",
          matureHeightCm: 120,
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

describe("CellPicker — stress dial label regression", () => {
  // The direct assertion for the reported bug: STRESS_DIAL_LABEL previously
  // had no "pestDisease" entry, so a planting whose dominant dial was
  // pestDisease rendered nothing for it at all.
  it('renders "pest & disease pressure" when dominantStressDial is "pestDisease"', () => {
    render(
      <CellPicker
        cell={baseCell()}
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
    expect(screen.getByText(/pest & disease pressure/i)).toBeInTheDocument();
  });
});

describe("CellPicker — soil card calcium regression", () => {
  // The direct assertion for the Phase C bug: the old EnvironmentReadout's
  // inline nutrient tuple omitted calciumPoolFraction even though the field
  // was already on the environment prop, so a calcium-only deficit was
  // never flagged. The new SoilCard renders exact per-nutrient numbers.
  it("shows the calcium percentage even when nitrogen/phosphorus/potassium are fine", () => {
    render(
      <CellPicker
        cell={baseCell({
          environment: {
            soilMoistureFraction: 0.5,
            soilTempC: 18,
            nitrogenPoolFraction: 0.6,
            phosphorusPoolFraction: 0.6,
            potassiumPoolFraction: 0.6,
            calciumPoolFraction: 0.12,
            micronutrientIndexFraction: 0.6,
            residueOrganicMatterPool: 0,
            mulchDepthMm: 0,
            daysNearSaturation: 0,
            weedPressureFraction: 0,
            evapotranspirationMm: 1.2,
          },
        })}
        plants={[{ id: "plant-tomato", commonName: "Tomato" }]}
        isOpen={false}
        isSubmitting={false}
        onOpen={vi.fn()}
        onAssign={vi.fn()}
        onAddCompanion={vi.fn()}
        onCancel={vi.fn()}
        onDeselect={vi.fn()}
        error={null}
        applyMulch={vi.fn()}
      />,
    );
    expect(screen.getByText(/Calcium \(Ca\): 12%/)).toBeInTheDocument();
  });
});

describe("CellPicker — companion effect badge", () => {
  it("renders the effect the primary planting receives from a same-cell companion", () => {
    render(
      <CellPicker
        cell={baseCell({
          plantIds: ["plant-tomato", "plant-bean"],
          plantings: [
            {
              id: "planting-1",
              plantId: "plant-tomato",
              harvestCount: 0,
              infections: [],
              companionEffects: [{ kind: "NITROGEN_FIX", sourceSpeciesKey: "pole-bean" }],
              growth: null,
            },
          ],
        })}
        plants={[
          { id: "plant-tomato", commonName: "Tomato" },
          { id: "plant-bean", commonName: "Pole Bean" },
        ]}
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
    expect(screen.getByText("Nitrogen boost")).toBeInTheDocument();
  });
});

describe("CellPicker — weeding action", () => {
  it("renders 'Apply weeding' and calls the action with the cell target on click", () => {
    const applyWeeding = vi.fn().mockResolvedValue({ ok: true });
    render(
      <CellPicker
        cell={baseCell()}
        plants={[{ id: "plant-tomato", commonName: "Tomato" }]}
        isOpen={false}
        isSubmitting={false}
        onOpen={vi.fn()}
        onAssign={vi.fn()}
        onAddCompanion={vi.fn()}
        onCancel={vi.fn()}
        onDeselect={vi.fn()}
        error={null}
        applyWeeding={applyWeeding}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply weeding/i }));
    expect(applyWeeding).toHaveBeenCalledWith({ bedId: "bed-1", column: 1, row: 1 });
  });

  it("doesn't render a weeding button when applyWeeding isn't provided", () => {
    render(
      <CellPicker
        cell={baseCell()}
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
    expect(screen.queryByRole("button", { name: /apply weeding/i })).not.toBeInTheDocument();
  });
});

function bedWithPredators(overrides: Partial<SnapshotBed> = {}): SnapshotBed {
  return {
    id: "bed-1",
    name: "North Bed",
    gridCols: 1,
    gridRows: 1,
    cells: [{ column: 1, row: 1, status: "EMPTY", plantIds: [], environment: null, plantings: [] }],
    equipment: [],
    pests: [],
    predators: [{ predatorKey: "ladybug", population: 2 }],
    soilProfile: null,
    ...overrides,
  };
}

describe("GardenGrid — predator chip", () => {
  it("renders a predator chip when a bed has an active predator population", () => {
    render(
      <GardenGrid beds={[bedWithPredators()]} plants={[]} selectedCell={null} onCellClick={vi.fn()} />,
    );
    expect(screen.getByText("Ladybug")).toBeInTheDocument();
  });

  it("renders no predator chip when no bed has an active predator population", () => {
    render(
      <GardenGrid beds={[bedWithPredators({ predators: [] })]} plants={[]} selectedCell={null} onCellClick={vi.fn()} />,
    );
    expect(screen.queryByText("Ladybug")).not.toBeInTheDocument();
  });
});

describe("GardenSummary — predator note", () => {
  it("renders a distinct, non-warning note when a bed has an active predator population", () => {
    render(<GardenSummary beds={[bedWithPredators()]} plants={[]} />);
    const note = screen.getByText(/ladybug active/i);
    expect(note).toBeInTheDocument();
    // Must not share a container with the warning-styled "Needs attention" block.
    expect(note.closest("p")).not.toHaveTextContent(/needs attention/i);
  });

  it("renders no predator note when no bed has an active predator population", () => {
    render(<GardenSummary beds={[bedWithPredators({ predators: [] })]} plants={[]} />);
    expect(screen.queryByText(/active/i)).not.toBeInTheDocument();
  });
});
