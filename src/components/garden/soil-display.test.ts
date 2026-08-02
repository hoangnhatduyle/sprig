import { describe, expect, it } from "vitest";
import {
  LOW_NUTRIENT_THRESHOLD,
  MIN_DISPLAY_WEED_PRESSURE,
  NUTRIENT_FIELDS,
  NUTRIENT_LABEL,
  cellSoilPhrase,
  lowNutrients,
  moistureHeatmapColor,
  textureLabel,
  weedPressureBand,
} from "./soil-display";

// Regression guard for the bug this module fixes: CellPicker.tsx previously
// hard-coded a 3-entry nutrient tuple that silently omitted calcium.
describe("NUTRIENT_FIELDS", () => {
  it("has all 4 nutrient pool fields including calcium", () => {
    expect(NUTRIENT_FIELDS).toHaveLength(4);
    expect(NUTRIENT_FIELDS).toContain("calciumPoolFraction");
    for (const field of NUTRIENT_FIELDS) {
      expect(NUTRIENT_LABEL[field]).toBeTruthy();
    }
  });
});

function environmentWith(overrides: Partial<Record<(typeof NUTRIENT_FIELDS)[number], number>>) {
  return {
    nitrogenPoolFraction: 0.6,
    phosphorusPoolFraction: 0.6,
    potassiumPoolFraction: 0.6,
    calciumPoolFraction: 0.6,
    ...overrides,
  };
}

describe("lowNutrients", () => {
  it("flags a calcium-only deficit that the old 3-field check would have missed", () => {
    const result = lowNutrients(environmentWith({ calciumPoolFraction: LOW_NUTRIENT_THRESHOLD - 0.01 }));
    expect(result).toEqual(["calciumPoolFraction"]);
  });

  it("returns an empty list when every nutrient is at or above the threshold", () => {
    expect(lowNutrients(environmentWith({}))).toEqual([]);
  });
});

describe("cellSoilPhrase", () => {
  it("returns null for a null environment", () => {
    expect(cellSoilPhrase(null)).toBeNull();
  });

  it("returns null when no nutrient is low", () => {
    expect(
      cellSoilPhrase({
        ...environmentWith({}),
        soilMoistureFraction: 0.5,
        soilTempC: 18,
        micronutrientIndexFraction: 0.6,
        residueOrganicMatterPool: 0,
        mulchDepthMm: 0,
        daysNearSaturation: 0,
        weedPressureFraction: 0,
        evapotranspirationMm: 1,
      }),
    ).toBeNull();
  });

  it("names the low nutrient(s)", () => {
    const phrase = cellSoilPhrase({
      ...environmentWith({ calciumPoolFraction: 0.1 }),
      soilMoistureFraction: 0.5,
      soilTempC: 18,
      micronutrientIndexFraction: 0.6,
      residueOrganicMatterPool: 0,
      mulchDepthMm: 0,
      daysNearSaturation: 0,
      weedPressureFraction: 0,
      evapotranspirationMm: 1,
    });
    expect(phrase).toBe("low on Calcium (Ca)");
  });
});

describe("textureLabel", () => {
  const base = { sandPct: 40, siltPct: 40, clayPct: 20, fieldCapacityFraction: 0.35, wiltingPointFraction: 0.12 };

  it("labels a clay-heavy profile", () => {
    expect(textureLabel({ ...base, sandPct: 20, siltPct: 30, clayPct: 50 })).toBe("clay-heavy");
  });

  it("labels a sandy profile", () => {
    expect(textureLabel({ ...base, sandPct: 70, siltPct: 20, clayPct: 10 })).toBe("sandy");
  });
});

describe("weedPressureBand", () => {
  it("bands low/moderate/high at the documented thresholds", () => {
    expect(weedPressureBand(0)).toBe("low");
    expect(weedPressureBand(0.3)).toBe("moderate");
    expect(weedPressureBand(0.6)).toBe("high");
  });
});

describe("moistureHeatmapColor", () => {
  it("produces a valid oklch string across the fraction range", () => {
    expect(moistureHeatmapColor(0)).toMatch(/^oklch\(/);
    expect(moistureHeatmapColor(1)).toMatch(/^oklch\(/);
  });

  it("clamps out-of-range fractions", () => {
    expect(moistureHeatmapColor(-1)).toBe(moistureHeatmapColor(0));
    expect(moistureHeatmapColor(2)).toBe(moistureHeatmapColor(1));
  });
});

describe("MIN_DISPLAY_WEED_PRESSURE", () => {
  it("is a small cosmetic threshold, not zero", () => {
    expect(MIN_DISPLAY_WEED_PRESSURE).toBeGreaterThan(0);
    expect(MIN_DISPLAY_WEED_PRESSURE).toBeLessThan(1);
  });
});
