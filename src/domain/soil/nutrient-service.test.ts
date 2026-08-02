import { describe, expect, it } from "vitest";
import { stepNutrientPools, type NutrientPoolState, type NutrientStepInputs } from "./nutrient-service";

function basePools(overrides: Partial<NutrientPoolState> = {}): NutrientPoolState {
  return {
    nitrogenPoolFraction: 0.6,
    phosphorusPoolFraction: 0.6,
    potassiumPoolFraction: 0.6,
    calciumPoolFraction: 0.6,
    micronutrientIndexFraction: 0.6,
    residueOrganicMatterPool: 0,
    ...overrides,
  };
}

function baseInputs(overrides: Partial<NutrientStepInputs> = {}): NutrientStepInputs {
  return {
    pools: basePools(),
    soilMoistureFraction: 0.6,
    soilTempC: 22,
    drainageMm: 0,
    rootFraction: 0.3,
    demand: { n: 1, p: 0.5, k: 0.5, ca: 0.3 },
    ...overrides,
  };
}

describe("stepNutrientPools", () => {
  it("uptake with no residue input depletes the pools over time", () => {
    const result = stepNutrientPools(baseInputs());
    expect(result.pools.nitrogenPoolFraction).toBeLessThan(0.6);
    expect(result.pools.phosphorusPoolFraction).toBeLessThan(0.6);
  });

  it("more root biomass draws down nutrients faster", () => {
    const smallRoot = stepNutrientPools(baseInputs({ rootFraction: 0.05 }));
    const bigRoot = stepNutrientPools(baseInputs({ rootFraction: 0.8 }));
    expect(bigRoot.pools.nitrogenPoolFraction).toBeLessThan(smallRoot.pools.nitrogenPoolFraction);
  });

  it("no moisture means no uptake — nutrientSatisfaction reflects the drought coupling", () => {
    const dry = stepNutrientPools(baseInputs({ soilMoistureFraction: 0 }));
    const wet = stepNutrientPools(baseInputs({ soilMoistureFraction: 1 }));
    expect(dry.nutrientSatisfaction.n).toBeLessThan(wet.nutrientSatisfaction.n);
  });

  it("residue decomposes into available N/P/K, with nitrogen released the most (RESIDUE_RELEASE_RATIO)", () => {
    const result = stepNutrientPools(
      baseInputs({
        pools: basePools({ nitrogenPoolFraction: 0, phosphorusPoolFraction: 0, potassiumPoolFraction: 0, residueOrganicMatterPool: 2 }),
        demand: { n: 0, p: 0, k: 0, ca: 0 }, // isolate decomposition from uptake
        rootFraction: 0,
      }),
    );
    expect(result.pools.nitrogenPoolFraction).toBeGreaterThan(0);
    expect(result.pools.nitrogenPoolFraction).toBeGreaterThan(result.pools.phosphorusPoolFraction);
    expect(result.pools.residueOrganicMatterPool).toBeLessThan(2);
  });

  it("decomposition stalls in bone-dry or fully-saturated soil (moistureResponse bell curve)", () => {
    const moderate = stepNutrientPools(
      baseInputs({ pools: basePools({ residueOrganicMatterPool: 2 }), soilMoistureFraction: 0.6, demand: { n: 0, p: 0, k: 0, ca: 0 } }),
    );
    const bone_dry = stepNutrientPools(
      baseInputs({ pools: basePools({ residueOrganicMatterPool: 2 }), soilMoistureFraction: 0, demand: { n: 0, p: 0, k: 0, ca: 0 } }),
    );
    expect(bone_dry.pools.residueOrganicMatterPool).toBeGreaterThan(moderate.pools.residueOrganicMatterPool);
  });

  it("leaching removes nitrogen fastest, phosphorus slowest, on a heavy drainage day (§7)", () => {
    const noDrainage = stepNutrientPools(baseInputs({ drainageMm: 0, demand: { n: 0, p: 0, k: 0, ca: 0 }, rootFraction: 0 }));
    const heavyDrainage = stepNutrientPools(baseInputs({ drainageMm: 60, demand: { n: 0, p: 0, k: 0, ca: 0 }, rootFraction: 0 }));

    const nitrogenLoss = noDrainage.pools.nitrogenPoolFraction - heavyDrainage.pools.nitrogenPoolFraction;
    const phosphorusLoss = noDrainage.pools.phosphorusPoolFraction - heavyDrainage.pools.phosphorusPoolFraction;
    expect(nitrogenLoss).toBeGreaterThan(phosphorusLoss);
    expect(nitrogenLoss).toBeGreaterThan(0);
  });

  it("pools never drop below 0 or exceed 1", () => {
    const result = stepNutrientPools(
      baseInputs({
        pools: basePools({ nitrogenPoolFraction: 0.01 }),
        drainageMm: 500,
        demand: { n: 5, p: 5, k: 5, ca: 5 },
        rootFraction: 1,
        soilMoistureFraction: 1,
      }),
    );
    expect(result.pools.nitrogenPoolFraction).toBeGreaterThanOrEqual(0);
    expect(result.pools.nitrogenPoolFraction).toBeLessThanOrEqual(1);
  });

  it("zero demand means full satisfaction trivially, not division by zero", () => {
    const result = stepNutrientPools(baseInputs({ demand: { n: 0, p: 0, k: 0, ca: 0 } }));
    expect(result.nutrientSatisfaction).toEqual({ n: 1, p: 1, k: 1, ca: 1 });
  });
});
