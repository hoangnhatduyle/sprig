import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ForecastStrip } from "./ForecastStrip";
import type { WeatherDayView } from "@/domain/weather/weather-service";

afterEach(() => {
  cleanup();
});

function day(overrides: Partial<WeatherDayView> = {}): WeatherDayView {
  return {
    date: new Date("2026-03-01T00:00:00.000Z"),
    condition: "CLEAR",
    tempHighC: 20,
    tempLowC: 10,
    precipitationMm: 0,
    cloudCoverPct: 10,
    humidityPct: 50,
    windSpeedKph: 5,
    source: "REAL_API",
    isSnowDay: false,
    ...overrides,
  };
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

describe("ForecastStrip", () => {
  it("renders nothing when forecast is empty", () => {
    const { container } = render(<ForecastStrip forecast={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one card per forecast day with condition label and hi/lo temps", () => {
    const forecast = [
      day({ date: new Date("2026-03-01T00:00:00.000Z"), condition: "CLEAR", tempHighC: 22, tempLowC: 12 }),
      day({ date: addUtcDays(new Date("2026-03-01T00:00:00.000Z"), 1), condition: "RAIN", tempHighC: 18, tempLowC: 9 }),
    ];

    render(<ForecastStrip forecast={forecast} />);

    expect(screen.getByText("Clear")).toBeInTheDocument();
    expect(screen.getByText("Rain")).toBeInTheDocument();
    expect(screen.getByText("12° – 22°C")).toBeInTheDocument();
    expect(screen.getByText("9° – 18°C")).toBeInTheDocument();
  });

  it("shows precipitation only when precipitationMm is greater than zero", () => {
    const forecast = [day({ precipitationMm: 0 })];
    render(<ForecastStrip forecast={forecast} />);
    expect(screen.queryByText(/mm/)).not.toBeInTheDocument();

    cleanup();

    const rainyForecast = [day({ precipitationMm: 6 })];
    render(<ForecastStrip forecast={rainyForecast} />);
    expect(screen.getByText("6mm")).toBeInTheDocument();
  });

  it("shows an 'Estimated' badge only for PROCEDURAL-sourced days", () => {
    const forecast = [
      day({ date: new Date("2026-03-01T00:00:00.000Z"), source: "REAL_API" }),
      day({ date: addUtcDays(new Date("2026-03-01T00:00:00.000Z"), 1), source: "PROCEDURAL" }),
    ];

    render(<ForecastStrip forecast={forecast} />);

    expect(screen.getAllByText("Estimated")).toHaveLength(1);
  });

  it("shows a Snow badge only on snow days", () => {
    const forecast = [day({ isSnowDay: true })];
    render(<ForecastStrip forecast={forecast} />);
    expect(screen.getByText("Snow")).toBeInTheDocument();
  });

  it("defaults to the card view and switches to the chart view on toggle", () => {
    const forecast = [day()];
    render(<ForecastStrip forecast={forecast} />);

    expect(document.getElementById("forecast-view-card-panel")).toBeInTheDocument();
    expect(document.getElementById("forecast-view-chart-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Chart" }));

    expect(document.getElementById("forecast-view-chart-panel")).toBeInTheDocument();
    expect(document.getElementById("forecast-view-card-panel")).not.toBeInTheDocument();
    // The chart view carries the same condition label forward.
    expect(screen.getByText("Clear")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Card" }));

    expect(document.getElementById("forecast-view-card-panel")).toBeInTheDocument();
    expect(document.getElementById("forecast-view-chart-panel")).not.toBeInTheDocument();
  });
});
