import { describe, expect, it } from "vitest";
import { getPestDefinition } from "./pest-catalog";
import { getPredatorDefinition } from "./predator-catalog";
import {
  computeDamageForPlanting,
  pestPressureDialValue,
  stepPestPopulations,
  stepPredatorPopulations,
} from "./pest-service";

const APHID = getPestDefinition("aphid")!;
const SLUG = getPestDefinition("slug")!;
const LADYBUG = getPredatorDefinition("ladybug")!;

describe("stepPestPopulations", () => {
  it("grows toward carrying capacity with no predators", () => {
    let populations = { [APHID.key]: 0.5 };
    for (let day = 0; day < 30; day += 1) {
      populations = stepPestPopulations([APHID], {
        populations,
        predatorPopulations: {},
        hostBiomass: 1,
        monthIndex1to12: 7,
      });
    }
    expect(populations[APHID.key]).toBeGreaterThan(0.5);
    // Capped near carryingCapacityPerHostBiomass x hostBiomass, not unbounded.
    expect(populations[APHID.key]).toBeLessThanOrEqual(APHID.carryingCapacityPerHostBiomass * 1.05);
  });

  it("decays toward the overwintering floor outside the active season", () => {
    const populations = stepPestPopulations([APHID], {
      populations: { [APHID.key]: 5 },
      predatorPopulations: {},
      hostBiomass: 1,
      monthIndex1to12: 1, // January — outside aphid's active season
    });
    expect(populations[APHID.key]).toBeLessThan(5);
  });

  it("a larger predator population suppresses pest growth", () => {
    const withoutPredators = stepPestPopulations([APHID], {
      populations: { [APHID.key]: 3 },
      predatorPopulations: {},
      hostBiomass: 1,
      monthIndex1to12: 7,
    })[APHID.key];
    const withPredators = stepPestPopulations([APHID], {
      populations: { [APHID.key]: 3 },
      predatorPopulations: { [LADYBUG.key]: 5 },
      hostBiomass: 1,
      monthIndex1to12: 7,
    })[APHID.key];
    expect(withPredators).toBeLessThan(withoutPredators);
  });
});

describe("stepPredatorPopulations", () => {
  it("grows faster with more available prey", () => {
    const lowPrey = stepPredatorPopulations([LADYBUG], {
      predatorPopulations: { [LADYBUG.key]: 1 },
      pestPopulations: { [APHID.key]: 0.5 },
      insectaryAttraction: 0,
    })[LADYBUG.key];
    const highPrey = stepPredatorPopulations([LADYBUG], {
      predatorPopulations: { [LADYBUG.key]: 1 },
      pestPopulations: { [APHID.key]: 20 },
      insectaryAttraction: 0,
    })[LADYBUG.key];
    expect(highPrey).toBeGreaterThan(lowPrey);
  });

  it("insectary attraction boosts immigration even with zero prey and zero starting population", () => {
    const noBoost = stepPredatorPopulations([LADYBUG], {
      predatorPopulations: { [LADYBUG.key]: 0 },
      pestPopulations: {},
      insectaryAttraction: 0,
    })[LADYBUG.key];
    const boosted = stepPredatorPopulations([LADYBUG], {
      predatorPopulations: { [LADYBUG.key]: 0 },
      pestPopulations: {},
      insectaryAttraction: 1,
    })[LADYBUG.key];
    expect(boosted).toBeGreaterThan(noBoost);
  });
});

describe("computeDamageForPlanting", () => {
  it("is neutral when the growth habit has no applicable pest population", () => {
    const damage = computeDamageForPlanting("ROOT_CROP", { [SLUG.key]: 10 }, false);
    expect(damage.leafLossFraction).toBe(0);
  });

  it("slugs hit seedlings harder than mature plants", () => {
    const seedlingDamage = computeDamageForPlanting("ROSETTE_LEAFY", { [SLUG.key]: 2 }, true);
    const matureDamage = computeDamageForPlanting("ROSETTE_LEAFY", { [SLUG.key]: 2 }, false);
    expect(seedlingDamage.leafLossFraction).toBeGreaterThan(matureDamage.leafLossFraction);
  });

  it("aphids only sap energy, never eat leaf", () => {
    const damage = computeDamageForPlanting("UPRIGHT_BUSH", { [APHID.key]: 3 }, false);
    expect(damage.energyPenalty).toBeGreaterThan(0);
    expect(damage.leafLossFraction).toBe(0);
  });
});

describe("pestPressureDialValue", () => {
  it("is zero with no pests present", () => {
    expect(pestPressureDialValue("UPRIGHT_BUSH", {})).toBe(0);
  });

  it("rises with pest population and stays within 0..1", () => {
    const low = pestPressureDialValue("UPRIGHT_BUSH", { [APHID.key]: 1 });
    const high = pestPressureDialValue("UPRIGHT_BUSH", { [APHID.key]: 100 });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(1);
  });
});
