import { describe, expect, it } from "vitest";
import type { DailyWeather } from "./weather-provider";
import { isSnowDay } from "./snow";

function weather(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return {
    date: new Date("2026-01-15T00:00:00Z"),
    tempHighC: 2,
    tempLowC: -3,
    precipitationMm: 5,
    cloudCoverPct: 80,
    humidityPct: 70,
    windSpeedKph: 10,
    condition: "RAIN",
    ...overrides,
  };
}

describe("isSnowDay", () => {
  it("is true when below freezing with precipitation", () => {
    expect(isSnowDay(weather({ tempLowC: -3, precipitationMm: 5 }))).toBe(true);
  });

  it("is false when above freezing, even with precipitation", () => {
    expect(isSnowDay(weather({ tempLowC: 5, precipitationMm: 5 }))).toBe(false);
  });

  it("is false when below freezing but dry", () => {
    expect(isSnowDay(weather({ tempLowC: -3, precipitationMm: 0 }))).toBe(false);
  });

  it("is true at exactly 0C with precipitation", () => {
    expect(isSnowDay(weather({ tempLowC: 0, precipitationMm: 1 }))).toBe(true);
  });
});
