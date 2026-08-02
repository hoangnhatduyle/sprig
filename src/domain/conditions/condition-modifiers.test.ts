import { describe, expect, it } from "vitest";
import { applyConditionModifiers, combineModifiers, NEUTRAL_MODIFIERS } from "./condition-modifiers";
import type { DailyWeather } from "@/domain/weather/weather-provider";

function weather(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return {
    date: new Date("2026-06-01T00:00:00Z"),
    tempHighC: 24,
    tempLowC: 14,
    precipitationMm: 5,
    cloudCoverPct: 40,
    humidityPct: 50,
    windSpeedKph: 8,
    condition: "PARTLY_CLOUDY",
    ...overrides,
  };
}

describe("combineModifiers", () => {
  it("multiplies factors together so multiple overrides stack", () => {
    const combined = combineModifiers({ lightMultiplier: 0.5, rainMultiplier: 1 }, { lightMultiplier: 1, rainMultiplier: 0.5 });
    expect(combined).toEqual({ lightMultiplier: 0.5, rainMultiplier: 0.5 });
  });

  it("neutral modifiers are the identity", () => {
    const custom = { lightMultiplier: 0.7, rainMultiplier: 1.3 };
    expect(combineModifiers(NEUTRAL_MODIFIERS, custom)).toEqual(custom);
  });
});

describe("applyConditionModifiers", () => {
  it("neutral modifiers leave weather unchanged", () => {
    const day = weather();
    expect(applyConditionModifiers(day, NEUTRAL_MODIFIERS)).toEqual(day);
  });

  it("a shade-cloth-style lightMultiplier < 1 raises effective cloud cover", () => {
    const day = weather({ cloudCoverPct: 20 });
    const result = applyConditionModifiers(day, { lightMultiplier: 0.5, rainMultiplier: 1 });
    expect(result.cloudCoverPct).toBeGreaterThan(day.cloudCoverPct);
  });

  it("a grow-light-style lightMultiplier > 1 lowers effective cloud cover, floored at 0", () => {
    const day = weather({ cloudCoverPct: 20 });
    const result = applyConditionModifiers(day, { lightMultiplier: 2, rainMultiplier: 1 });
    expect(result.cloudCoverPct).toBe(0);
  });

  it("a rain-cover-style rainMultiplier < 1 reduces precipitation reaching the soil", () => {
    const day = weather({ precipitationMm: 10 });
    const result = applyConditionModifiers(day, { lightMultiplier: 1, rainMultiplier: 0.2 });
    expect(result.precipitationMm).toBeCloseTo(2, 5);
  });

  it("precipitation never goes negative", () => {
    const day = weather({ precipitationMm: 10 });
    const result = applyConditionModifiers(day, { lightMultiplier: 1, rainMultiplier: -1 });
    expect(result.precipitationMm).toBeGreaterThanOrEqual(0);
  });
});
