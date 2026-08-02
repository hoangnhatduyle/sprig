import { describe, expect, it } from "vitest";
import {
  deriveSoilConstants,
  estimateEvapotranspirationDisplayMm,
  estimateReferenceEt0Mm,
  mulchDampeningFromDepth,
  mulchFactorFromDepth,
  stepSoilTemperature,
  stepWaterBucket,
  type WaterBucketInputs,
} from "./water-bucket-service";
import { InvalidSoilTextureError } from "./errors";

// Phase C: this display-time recompute must match the real simulation's
// inline formula exactly (daily-step-orchestrator.ts's et0Mm/cropCoefficient
// inputs to stepWaterBucket) — these tests pin the extracted formula's
// values so the two can never silently diverge.
describe("estimateReferenceEt0Mm", () => {
  it("is zero at or below the 5C floor", () => {
    expect(estimateReferenceEt0Mm(5)).toBe(0);
    expect(estimateReferenceEt0Mm(-10)).toBe(0);
  });

  it("scales linearly above the floor, matching the orchestrator's original inline formula", () => {
    expect(estimateReferenceEt0Mm(25)).toBeCloseTo((25 - 5) * 0.15, 10);
  });
});

describe("estimateEvapotranspirationDisplayMm", () => {
  it("reduces to the reference ET when there's no mulch", () => {
    const value = estimateEvapotranspirationDisplayMm({ meanTempC: 25, mulchDepthMm: 0 });
    expect(value).toBeCloseTo(estimateReferenceEt0Mm(25), 10);
  });

  it("is suppressed by deep mulch", () => {
    const unmulched = estimateEvapotranspirationDisplayMm({ meanTempC: 25, mulchDepthMm: 0 });
    const mulched = estimateEvapotranspirationDisplayMm({ meanTempC: 25, mulchDepthMm: 50 });
    expect(mulched).toBeLessThan(unmulched);
  });
});

describe("deriveSoilConstants", () => {
  it("rejects a texture that doesn't sum to 100", () => {
    expect(() => deriveSoilConstants(50, 30, 10)).toThrow(InvalidSoilTextureError);
  });

  it("gives clay-heavy soil a higher field capacity than sandy soil", () => {
    const sandy = deriveSoilConstants(80, 15, 5);
    const clayey = deriveSoilConstants(10, 30, 60);
    expect(clayey.fieldCapacityFraction).toBeGreaterThan(sandy.fieldCapacityFraction);
    expect(clayey.wiltingPointFraction).toBeGreaterThan(sandy.wiltingPointFraction);
  });
});

function baseInputs(overrides: Partial<WaterBucketInputs> = {}): WaterBucketInputs {
  return {
    soilMoistureFraction: 0.5,
    rainMm: 0,
    irrigationMm: 0,
    et0Mm: 3,
    cropCoefficient: 1,
    mulchFactor: 1,
    fieldCapacityFraction: 0.35,
    wiltingPointFraction: 0.12,
    ...overrides,
  };
}

describe("stepWaterBucket", () => {
  it("rain raises soil moisture", () => {
    const dry = stepWaterBucket(baseInputs({ rainMm: 0 }));
    const rained = stepWaterBucket(baseInputs({ rainMm: 20 }));
    expect(rained.soilMoistureFraction).toBeGreaterThan(dry.soilMoistureFraction);
  });

  it("evapotranspiration demand lowers soil moisture", () => {
    const lowDemand = stepWaterBucket(baseInputs({ et0Mm: 1 }));
    const highDemand = stepWaterBucket(baseInputs({ et0Mm: 8 }));
    expect(highDemand.soilMoistureFraction).toBeLessThan(lowDemand.soilMoistureFraction);
  });

  it("moisture never drops below the wilting point (fraction 0)", () => {
    const result = stepWaterBucket(baseInputs({ soilMoistureFraction: 0, et0Mm: 50, rainMm: 0 }));
    expect(result.soilMoistureFraction).toBeGreaterThanOrEqual(0);
  });

  it("a heavy downpour drains excess above field capacity instead of storing it indefinitely", () => {
    const result = stepWaterBucket(baseInputs({ soilMoistureFraction: 1, rainMm: 200, et0Mm: 0 }));
    expect(result.drainageMm).toBeGreaterThan(0);
  });

  it("mulch reduces the effective evapotranspiration demand", () => {
    const noMulch = stepWaterBucket(baseInputs({ mulchFactor: 1, et0Mm: 5 }));
    const mulched = stepWaterBucket(baseInputs({ mulchFactor: 0.5, et0Mm: 5 }));
    expect(mulched.soilMoistureFraction).toBeGreaterThan(noMulch.soilMoistureFraction);
  });
});

describe("stepSoilTemperature", () => {
  it("moves toward the mean air temperature but doesn't jump there instantly", () => {
    const next = stepSoilTemperature(10, 25, 1);
    expect(next).toBeGreaterThan(10);
    expect(next).toBeLessThan(25);
  });

  it("mulch dampens the day-to-day swing", () => {
    const bareSoil = stepSoilTemperature(10, 25, 1);
    const mulchedSoil = stepSoilTemperature(10, 25, 0.3);
    expect(mulchedSoil - 10).toBeLessThan(bareSoil - 10);
  });
});

// SPEC-GROWTH-002: converts CellEnvironmentState.mulchDepthMm into the
// mulchFactor/mulchDampening params above, which every Phase 1 caller
// previously hardcoded to 1 (no mulch).
describe("mulchFactorFromDepth", () => {
  it("no mulch means no evaporation suppression", () => {
    expect(mulchFactorFromDepth(0)).toBe(1);
  });

  it("deeper mulch suppresses evaporation more, up to the documented ~40% ceiling", () => {
    const thin = mulchFactorFromDepth(10);
    const thick = mulchFactorFromDepth(50);
    expect(thick).toBeLessThan(thin);
    expect(thick).toBeGreaterThanOrEqual(0.6);
  });

  it("clamps beyond the depth-for-max-effect point instead of suppressing past the ceiling", () => {
    expect(mulchFactorFromDepth(50)).toBeCloseTo(mulchFactorFromDepth(150), 10);
  });
});

describe("mulchDampeningFromDepth", () => {
  it("no mulch means no extra temperature dampening", () => {
    expect(mulchDampeningFromDepth(0)).toBe(1);
  });

  it("deeper mulch dampens soil-temp swings more", () => {
    expect(mulchDampeningFromDepth(50)).toBeLessThan(mulchDampeningFromDepth(10));
  });
});
