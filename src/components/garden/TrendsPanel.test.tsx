import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InventorySnapshot } from "@/domain/plant-catalog/inventory-service";
import type { YieldTrendPoint } from "@/domain/journal/yield-trend-service";
import type { WeatherDayView } from "@/domain/weather/weather-service";
import { TrendsPanel } from "./TrendsPanel";
import type { SnapshotBed } from "./types";

// jsdom has no layout engine, so Recharts' ResponsiveContainer always
// measures a 0x0 parent and renders no SVG children — stub the one API it
// reads so the chart components actually render their <svg> for assertions.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 600,
    height: 260,
    top: 0,
    left: 0,
    right: 600,
    bottom: 260,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function bed(overrides: Partial<SnapshotBed> = {}): SnapshotBed {
  return {
    id: "bed-1",
    name: "North Bed",
    gridCols: 1,
    gridRows: 1,
    cells: [],
    equipment: [],
    pests: [],
    predators: [],
    soilProfile: null,
    ...overrides,
  };
}

function inventory(): InventorySnapshot {
  return {
    seeds: [
      {
        id: "plant-tomato",
        commonName: "Tomato",
        waterNeed: null,
        lightNeed: null,
        isCompanionPlanting: false,
        notes: null,
        seedQuantity: 5,
        seedUnit: "seed",
        seedsPerUnit: 1,
        unitQuantity: 5,
        imageUrl: null,
        speciesProfileId: null,
        speciesProfileName: null,
      },
    ],
    yields: [],
  };
}

describe("TrendsPanel", () => {
  it("lists beds and plants as filter options", () => {
    render(<TrendsPanel beds={[bed()]} inventory={inventory()} />);
    expect(screen.getByRole("option", { name: "North Bed" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tomato" })).toBeInTheDocument();
  });

  it("fetches and renders both trends when Generate is clicked", async () => {
    const yieldTrend: YieldTrendPoint[] = [{ dateIso: "2026-06-01", totalsByUnit: [{ unit: "kg", amount: 5 }] }];
    const weatherTrend: WeatherDayView[] = [
      {
        date: new Date("2026-06-01T00:00:00.000Z"),
        condition: "CLEAR",
        tempHighC: 22,
        tempLowC: 12,
        precipitationMm: 0,
        cloudCoverPct: 10,
        humidityPct: 40,
        windSpeedKph: 5,
        source: "REAL_API",
        isSnowDay: false,
      },
    ];
    const getYieldTrend = vi.fn().mockResolvedValue(yieldTrend);
    const getWeatherTrend = vi.fn().mockResolvedValue(weatherTrend);

    render(
      <TrendsPanel
        beds={[bed()]}
        inventory={inventory()}
        getYieldTrend={getYieldTrend}
        getWeatherTrend={getWeatherTrend}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    expect(await screen.findByText("Yield over time")).toBeInTheDocument();
    expect(screen.getByText("Weather trends")).toBeInTheDocument();
    expect(getYieldTrend).toHaveBeenCalledTimes(1);
    expect(getWeatherTrend).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when the actions return null for an invalid range", async () => {
    const getYieldTrend = vi.fn().mockResolvedValue(null);
    const getWeatherTrend = vi.fn().mockResolvedValue(null);

    render(
      <TrendsPanel
        beds={[bed()]}
        inventory={inventory()}
        getYieldTrend={getYieldTrend}
        getWeatherTrend={getWeatherTrend}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a valid date range.");
  });

  it("shows empty-state copy when a range has no harvests or weather", async () => {
    const getYieldTrend = vi.fn().mockResolvedValue([]);
    const getWeatherTrend = vi.fn().mockResolvedValue([]);

    render(
      <TrendsPanel
        beds={[bed()]}
        inventory={inventory()}
        getYieldTrend={getYieldTrend}
        getWeatherTrend={getWeatherTrend}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    expect(await screen.findByText("No harvests recorded in this range yet.")).toBeInTheDocument();
    expect(screen.getByText("No weather history recorded in this range yet.")).toBeInTheDocument();
  });
});
