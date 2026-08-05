import { describe, expect, it } from "vitest";
import { estimatedHeightCm, stageProgress } from "./growth-progress";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-GROWTH-004.yaml
// Unit coverage for the pure helpers behind GrowthReadout's new progress
// meter and height estimate — cheapest place to lock in AC-4's terminal-
// stage / edge-case contract without spinning up Postgres or jsdom.

const baseThresholds = {
  gddToVegetative: 100,
  gddToFlowering: 300,
  gddToFruiting: 600,
  gddToMaturity: 900,
};

describe("stageProgress", () => {
  it("T-SPEC-GROWTH-004-AC-AC_1: computes fraction toward FLOWERING for a VEGETATIVE-stage planting", () => {
    const result = stageProgress({
      phenologyStage: "VEGETATIVE",
      accumulatedGdd: 200, // halfway between gddToVegetative (100) and gddToFlowering (300)
      ...baseThresholds,
    });
    expect(result).not.toBeNull();
    expect(result!.nextStage).toBe("FLOWERING");
    expect(result!.fraction).toBeCloseTo(0.5, 5);
  });

  it("T-SPEC-GROWTH-004-AC-AC_4: returns null for MATURE (terminal stage)", () => {
    expect(stageProgress({ phenologyStage: "MATURE", accumulatedGdd: 950, ...baseThresholds })).toBeNull();
  });

  it("T-SPEC-GROWTH-004-AC-AC_4: returns null for SENESCENT (terminal stage)", () => {
    expect(stageProgress({ phenologyStage: "SENESCENT", accumulatedGdd: 950, ...baseThresholds })).toBeNull();
  });

  it("T-SPEC-GROWTH-004-AC-AC_4: returns null for DEAD (terminal stage)", () => {
    expect(stageProgress({ phenologyStage: "DEAD", accumulatedGdd: 950, ...baseThresholds })).toBeNull();
  });

  it("clamps fraction to 1 when accumulatedGdd is already past the next threshold (never > 1, never NaN)", () => {
    const result = stageProgress({ phenologyStage: "VEGETATIVE", accumulatedGdd: 10_000, ...baseThresholds });
    expect(result!.fraction).toBe(1);
    expect(Number.isFinite(result!.fraction)).toBe(true);
  });

  it("clamps fraction to 0 when accumulatedGdd is below the current stage's own threshold (never negative)", () => {
    const result = stageProgress({ phenologyStage: "VEGETATIVE", accumulatedGdd: 0, ...baseThresholds });
    expect(result!.fraction).toBe(0);
  });

  it("guards divide-by-zero/inverted thresholds from misconfigured species data (never NaN/Infinity)", () => {
    const result = stageProgress({
      phenologyStage: "VEGETATIVE",
      accumulatedGdd: 150,
      gddToVegetative: 100,
      gddToFlowering: 100, // misconfigured: equal to gddToVegetative
      gddToFruiting: 600,
      gddToMaturity: 900,
    });
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.fraction)).toBe(true);
    expect(result!.fraction).toBe(1);
  });

  it("guards a non-finite accumulatedGdd from corrupted upstream data (never NaN)", () => {
    const result = stageProgress({ phenologyStage: "VEGETATIVE", accumulatedGdd: NaN, ...baseThresholds });
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.fraction)).toBe(true);
  });
});

describe("estimatedHeightCm", () => {
  it("T-SPEC-GROWTH-004-AC-AC_2: derives a proportional height from leaf/stem/root fractions", () => {
    const height = estimatedHeightCm({
      matureHeightCm: 150,
      leafFraction: 0.1,
      stemFraction: 0.1,
      rootFraction: 0,
    });
    expect(height).toBeCloseTo(150 * 0.2, 5);
  });

  it("clamps biomassFraction so height never exceeds matureHeightCm", () => {
    const height = estimatedHeightCm({
      matureHeightCm: 150,
      leafFraction: 0.9,
      stemFraction: 0.9,
      rootFraction: 0.9,
    });
    expect(height).toBe(150);
  });
});
