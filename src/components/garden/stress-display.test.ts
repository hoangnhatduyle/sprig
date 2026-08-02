import { describe, expect, it } from "vitest";
import { STRESS_DIAL_KEYS, STRESS_DIAL_LABEL, healthBand } from "./stress-display";

describe("STRESS_DIAL_LABEL", () => {
  // The regression guard for the reported bug: STRESS_DIAL_LABEL previously
  // (when it lived inline in CellPicker.tsx) had no entry for "pestDisease"
  // — stress-service.ts's StressDials interface declares 9 dials, but the
  // display map only covered 8, so a planting whose dominant dial was
  // pestDisease silently rendered nothing at all. Every key stress-service.ts
  // declares must resolve to a real, non-empty label.
  it("has a real label for every stress dial stress-service.ts declares", () => {
    for (const key of STRESS_DIAL_KEYS) {
      expect(STRESS_DIAL_LABEL[key]).toBeTypeOf("string");
      expect(STRESS_DIAL_LABEL[key].length).toBeGreaterThan(0);
    }
  });

  it("specifically covers pestDisease (SPEC-GROWTH-003's addition to the original 8 dials)", () => {
    expect(STRESS_DIAL_LABEL.pestDisease).toBe("pest & disease pressure");
  });
});

function makeGrowth(overrides: Partial<Parameters<typeof healthBand>[0]> = {}) {
  return {
    phenologyStage: "VEGETATIVE",
    cumulativeStress: 0,
    waterContentIndex: 1,
    dominantStressDial: null,
    ...overrides,
  };
}

describe("healthBand", () => {
  it("is healthy with no stress signals", () => {
    expect(healthBand(makeGrowth())).toBe("healthy");
  });

  it("is watch once a dial crosses the dominant-dial display threshold, even with low cumulative stress", () => {
    expect(healthBand(makeGrowth({ dominantStressDial: "drought" }))).toBe("watch");
  });

  it("is stressed when wilting (waterContentIndex < 0.5), independent of cumulativeStress", () => {
    expect(healthBand(makeGrowth({ waterContentIndex: 0.3 }))).toBe("stressed");
  });

  it("is stressed at the CellPicker-matching 0.6 sustained-stress threshold", () => {
    expect(healthBand(makeGrowth({ cumulativeStress: 0.6 }))).toBe("stressed");
  });

  it("is critical once cumulativeStress crosses 0.75", () => {
    expect(healthBand(makeGrowth({ cumulativeStress: 0.75 }))).toBe("critical");
  });

  it("is always critical for a DEAD plant regardless of other dials", () => {
    expect(healthBand(makeGrowth({ phenologyStage: "DEAD", cumulativeStress: 0, waterContentIndex: 1 }))).toBe(
      "critical",
    );
  });
});
