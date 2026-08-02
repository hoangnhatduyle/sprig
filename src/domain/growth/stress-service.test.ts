import { describe, expect, it } from "vitest";
import type { DailyWeather } from "@/domain/weather/weather-provider";
import { combineStress, computeStressDials, dominantStressLabel, stepDaysNearSaturation, type StressInputs, type StressSpeciesParams } from "./stress-service";

const SPECIES: StressSpeciesParams = {
  heatStressThresholdC: 32,
  coldStressThresholdC: 10,
  droughtComfortFraction: 0.5,
  lightNeedFraction: 0.6,
  windLodgingThresholdKph: 45,
};

function weather(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return {
    date: new Date("2026-06-01T00:00:00Z"),
    tempHighC: 24,
    tempLowC: 14,
    precipitationMm: 0,
    cloudCoverPct: 20,
    humidityPct: 50,
    windSpeedKph: 8,
    condition: "PARTLY_CLOUDY",
    ...overrides,
  };
}

function inputs(overrides: Partial<StressInputs> = {}): StressInputs {
  return {
    weather: weather(),
    soilMoistureFraction: 0.6,
    daysNearSaturation: 0,
    baselineLight: "FULL_SUN",
    nutrientSatisfaction: { n: 1, p: 1, k: 1, ca: 1 },
    plantingAgeDays: 999,
    species: SPECIES,
    pestDiseaseSeverity: 0,
    ...overrides,
  };
}

describe("stepDaysNearSaturation", () => {
  it("grows the streak on a saturated day", () => {
    expect(stepDaysNearSaturation(0, 0.95)).toBe(1);
    expect(stepDaysNearSaturation(3, 0.95)).toBe(4);
  });

  it("decays (floored at 0) on a non-saturated day", () => {
    expect(stepDaysNearSaturation(3, 0.5)).toBe(2);
    expect(stepDaysNearSaturation(0, 0.5)).toBe(0);
  });
});

describe("computeStressDials — overwater", () => {
  it("stays at zero within the grace period", () => {
    const dials = computeStressDials(inputs({ daysNearSaturation: 2 }));
    expect(dials.overwater).toBe(0);
  });

  it("rises once the saturated streak exceeds the grace period", () => {
    const dials = computeStressDials(inputs({ daysNearSaturation: 6 }));
    expect(dials.overwater).toBeGreaterThan(0);
  });
});

describe("computeStressDials — shade", () => {
  it("full sun satisfies a species with moderate light need", () => {
    const dials = computeStressDials(inputs({ baselineLight: "FULL_SUN", species: { ...SPECIES, lightNeedFraction: 0.6 } }));
    expect(dials.shade).toBe(0);
  });

  it("partial shade stresses a species that needs full sun", () => {
    const dials = computeStressDials(inputs({ baselineLight: "PARTIAL_SHADE", species: { ...SPECIES, lightNeedFraction: 0.9 } }));
    expect(dials.shade).toBeGreaterThan(0);
  });

  it("a shade-tolerant species (low lightNeedFraction) isn't stressed by partial shade", () => {
    const dials = computeStressDials(inputs({ baselineLight: "PARTIAL_SHADE", species: { ...SPECIES, lightNeedFraction: 0.4 } }));
    expect(dials.shade).toBe(0);
  });
});

describe("computeStressDials — nutrient", () => {
  it("is zero when every nutrient is fully satisfied", () => {
    const dials = computeStressDials(inputs({ nutrientSatisfaction: { n: 1, p: 1, k: 1, ca: 1 } }));
    expect(dials.nutrient).toBe(0);
  });

  it("reflects the WORST nutrient deficit, not an average", () => {
    const dials = computeStressDials(inputs({ nutrientSatisfaction: { n: 1, p: 1, k: 0.1, ca: 1 } }));
    expect(dials.nutrient).toBeCloseTo(0.9, 5);
  });
});

describe("computeStressDials — transplant shock", () => {
  it("is at its worst on the day of planting", () => {
    const dials = computeStressDials(inputs({ plantingAgeDays: 0 }));
    expect(dials.transplantShock).toBeCloseTo(1, 5);
  });

  it("decays toward zero over the following days", () => {
    const day1 = computeStressDials(inputs({ plantingAgeDays: 1 })).transplantShock;
    const day5 = computeStressDials(inputs({ plantingAgeDays: 5 })).transplantShock;
    const day20 = computeStressDials(inputs({ plantingAgeDays: 20 })).transplantShock;
    expect(day5).toBeLessThan(day1);
    expect(day20).toBeLessThan(day5);
    expect(day20).toBeCloseTo(0, 2);
  });
});

describe("computeStressDials — wind", () => {
  it("is zero below the species' lodging threshold", () => {
    const dials = computeStressDials(inputs({ weather: weather({ windSpeedKph: 20 }) }));
    expect(dials.wind).toBe(0);
  });

  it("rises above the species' lodging threshold", () => {
    const dials = computeStressDials(inputs({ weather: weather({ windSpeedKph: 60 }) }));
    expect(dials.wind).toBeGreaterThan(0);
  });
});

describe("combineStress", () => {
  it("is the maximum of all 9 dials (Liebig's Law), not a sum or average", () => {
    const dials = {
      heat: 0.1,
      cold: 0,
      drought: 0.2,
      overwater: 0,
      shade: 0.05,
      nutrient: 0.7,
      transplantShock: 0,
      wind: 0.3,
      pestDisease: 0,
    };
    expect(combineStress(dials)).toBe(0.7);
  });

  it("pestDisease can itself be the limiting dial", () => {
    const dials = {
      heat: 0.1,
      cold: 0,
      drought: 0.2,
      overwater: 0,
      shade: 0.05,
      nutrient: 0.1,
      transplantShock: 0,
      wind: 0.3,
      pestDisease: 0.85,
    };
    expect(combineStress(dials)).toBe(0.85);
  });
});

describe("dominantStressLabel", () => {
  it("returns null when nothing crosses the display threshold", () => {
    const dials = {
      heat: 0.1,
      cold: 0.1,
      drought: 0.1,
      overwater: 0.1,
      shade: 0.1,
      nutrient: 0.1,
      transplantShock: 0.1,
      wind: 0.1,
      pestDisease: 0.1,
    };
    expect(dominantStressLabel(dials)).toBeNull();
  });

  it("names the single largest dial once it crosses the threshold", () => {
    const dials = {
      heat: 0.1,
      cold: 0.1,
      drought: 0.1,
      overwater: 0.1,
      shade: 0.1,
      nutrient: 0.65,
      transplantShock: 0.1,
      wind: 0.1,
      pestDisease: 0.1,
    };
    expect(dominantStressLabel(dials)).toBe("nutrient");
  });

  it("names pestDisease when it's the dominant dial", () => {
    const dials = {
      heat: 0.1,
      cold: 0.1,
      drought: 0.1,
      overwater: 0.1,
      shade: 0.1,
      nutrient: 0.1,
      transplantShock: 0.1,
      wind: 0.1,
      pestDisease: 0.7,
    };
    expect(dominantStressLabel(dials)).toBe("pestDisease");
  });
});
