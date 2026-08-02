import { describe, expect, it } from "vitest";
import {
  dailyGdd,
  NEUTRAL_DIRECT_EFFECTS,
  stepDailyGrowth,
  type BiologyState,
  type DailyEnvironmentInputs,
  type SpeciesGrowthParams,
} from "./growth-engine-service";
import type { DailyWeather } from "@/domain/weather/weather-provider";

const SPECIES: SpeciesGrowthParams = {
  baseTempC: 10,
  gddToGerminate: 20,
  gddToVegetative: 100,
  gddToFlowering: 250,
  gddToFruiting: 400,
  gddToMaturity: 700,
  heatStressThresholdC: 32,
  coldStressThresholdC: 10,
  droughtComfortFraction: 0.5,
  lightNeedFraction: 0.6,
  windLodgingThresholdKph: 45,
  baseNutrientDemand: 1,
  pollinationDependency: "SELF",
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

// Everything at its most-neutral value (no overwater streak, full sun, full
// nutrient satisfaction, long past transplant shock, fully pollinated) so
// existing tests exercise only the dial(s) they're actually about — new
// Phase 2 dials are covered in their own stress-service.test.ts instead.
function env(soilMoistureFraction: number, overrides: Partial<DailyEnvironmentInputs> = {}): DailyEnvironmentInputs {
  return {
    soilMoistureFraction,
    daysNearSaturation: 0,
    baselineLight: "FULL_SUN",
    nutrientSatisfaction: { n: 1, p: 1, k: 1, ca: 1 },
    plantingAgeDays: 999,
    pollinatorActivity: 1,
    allelopathicPenalty: 0,
    pestDiseaseSeverity: 0,
    diseaseLightPenalty: 0,
    directEffects: NEUTRAL_DIRECT_EFFECTS,
    ...overrides,
  };
}

const FRESH_BIOLOGY: BiologyState = {
  accumulatedGdd: 0,
  phenologyStage: "GERMINATING",
  leafFraction: 0.05,
  stemFraction: 0.05,
  rootFraction: 0.1,
  flowerFraction: 0,
  fruitFraction: 0,
  storedReserves: 0.2,
  waterContentIndex: 1,
  cumulativeStress: 0,
};

describe("dailyGdd", () => {
  it("accumulates heat above the species base temperature", () => {
    expect(dailyGdd(30, 20, 10)).toBe(15); // mean 25, base 10
  });

  it("never goes negative below the base temperature", () => {
    expect(dailyGdd(5, -5, 10)).toBe(0); // mean 0, base 10
  });
});

describe("stepDailyGrowth", () => {
  it("a warm week accumulates more GDD and more biomass than a cold week (AC-3)", () => {
    let warm = FRESH_BIOLOGY;
    let cold = FRESH_BIOLOGY;
    for (let day = 0; day < 7; day += 1) {
      warm = stepDailyGrowth(SPECIES, warm, weather({ tempHighC: 30, tempLowC: 22, cloudCoverPct: 10 }), env(0.6)).biology;
      cold = stepDailyGrowth(SPECIES, cold, weather({ tempHighC: 12, tempLowC: 6, cloudCoverPct: 10 }), env(0.6)).biology;
    }
    expect(warm.accumulatedGdd).toBeGreaterThan(cold.accumulatedGdd);
    expect(warm.leafFraction + warm.stemFraction + warm.rootFraction).toBeGreaterThan(
      cold.leafFraction + cold.stemFraction + cold.rootFraction,
    );
  });

  it("well-fed comfortable conditions advance phenology past GERMINATING", () => {
    let biology = FRESH_BIOLOGY;
    for (let day = 0; day < 40; day += 1) {
      biology = stepDailyGrowth(SPECIES, biology, weather(), env(0.6)).biology;
    }
    expect(biology.accumulatedGdd).toBeGreaterThan(SPECIES.gddToVegetative);
    expect(biology.phenologyStage).not.toBe("GERMINATING");
  });

  it("drought raises the drought stress dial and lowers the water content index", () => {
    const dry = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.05));
    const wet = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.9));
    expect(dry.stress.drought).toBeGreaterThan(wet.stress.drought);
    expect(dry.biology.waterContentIndex).toBeLessThan(wet.biology.waterContentIndex);
  });

  it("sustained extreme heat with no reserves eventually kills the planting (AC-4)", () => {
    let biology: BiologyState = { ...FRESH_BIOLOGY, storedReserves: 0 };
    const extremeHeat = weather({ tempHighC: 48, tempLowC: 40, cloudCoverPct: 0 });
    let stepsRun = 0;
    while (biology.phenologyStage !== "DEAD" && stepsRun < 100) {
      biology = stepDailyGrowth(SPECIES, biology, extremeHeat, env(0.05)).biology;
      stepsRun += 1;
    }
    expect(biology.phenologyStage).toBe("DEAD");

    // DEAD is terminal for the daily step: another step under any weather
    // leaves biology exactly as-is rather than reviving or further changing it.
    const after = stepDailyGrowth(SPECIES, biology, weather(), env(0.9));
    expect(after.biology.phenologyStage).toBe("DEAD");
    expect(after.biology).toEqual(biology);
  });

  it("Liebig's Law: growth is capped by the single worst stressor, not an average of all of them", () => {
    // Moderate, fixed cold stress (tempLowC 4 vs. coldStressThresholdC 10 ->
    // cold ~= 0.5) in every run below. If growth were an AVERAGE of all
    // active stressors, any nonzero drought would always slow growth
    // further than zero drought. Under Liebig's Law it should not, as long
    // as drought stays below the cold stress already present.
    const coldStressWeather = weather({ tempLowC: 4, tempHighC: 14 });

    const noDrought = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, coldStressWeather, env(1.0)); // drought clamps to 0
    const mildDrought = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, coldStressWeather, env(0.4)); // drought ~0.2, still < cold ~0.5

    expect(mildDrought.stress.drought).toBeGreaterThan(0);
    expect(mildDrought.stress.drought).toBeLessThan(mildDrought.stress.cold);
    // A smaller secondary stressor doesn't move the needle: growth this day
    // is identical, because cold alone is still the limiting factor.
    expect(mildDrought.biology.leafFraction).toBeCloseTo(noDrought.biology.leafFraction, 10);

    const severeDrought = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, coldStressWeather, env(0.05)); // drought ~0.9, now worse than cold
    expect(severeDrought.stress.drought).toBeGreaterThan(severeDrought.stress.cold);
    // Once drought overtakes cold as the worst stressor, IT drives growth
    // down further — this is the "capped by the scarcest resource" half of
    // the law.
    expect(severeDrought.biology.leafFraction).toBeLessThan(mildDrought.biology.leafFraction);
  });
});

describe("pollination-gated fruit-set (SPEC-GROWTH-002)", () => {
  const FRUITING_BIOLOGY: BiologyState = {
    ...FRESH_BIOLOGY,
    accumulatedGdd: SPECIES.gddToFruiting + 10,
    phenologyStage: "FRUITING",
    leafFraction: 0.4,
    stemFraction: 0.2,
    rootFraction: 0.2,
    flowerFraction: 0.1,
    fruitFraction: 0.1,
  };

  it("a SELF-pollinated species converts flower to fruit regardless of pollinator activity", () => {
    const selfSpecies: SpeciesGrowthParams = { ...SPECIES, pollinationDependency: "SELF" };
    const highPollination = stepDailyGrowth(selfSpecies, FRUITING_BIOLOGY, weather(), env(0.6, { pollinatorActivity: 1 }));
    const noPollination = stepDailyGrowth(selfSpecies, FRUITING_BIOLOGY, weather(), env(0.6, { pollinatorActivity: 0 }));
    expect(highPollination.biology.fruitFraction).toBeCloseTo(noPollination.biology.fruitFraction, 10);
  });

  it("an INSECT-dependent species converts less flower to fruit when pollinator activity is low, keeping the rest as flowers", () => {
    const insectSpecies: SpeciesGrowthParams = { ...SPECIES, pollinationDependency: "INSECT" };
    const highPollination = stepDailyGrowth(insectSpecies, FRUITING_BIOLOGY, weather(), env(0.6, { pollinatorActivity: 1 }));
    const lowPollination = stepDailyGrowth(insectSpecies, FRUITING_BIOLOGY, weather(), env(0.6, { pollinatorActivity: 0.1 }));

    expect(lowPollination.biology.fruitFraction).toBeLessThan(highPollination.biology.fruitFraction);
    // The unconverted growth budget lands back in the flower pool rather
    // than vanishing (NC-SPRIG-GROWTH2-POLLINATION-NEVER-DESTROYS-BIOMASS).
    expect(lowPollination.biology.flowerFraction).toBeGreaterThan(highPollination.biology.flowerFraction);
  });
});

describe("disease/pest/weed effects (SPEC-GROWTH-003)", () => {
  it("pestDiseaseSeverity feeds the stress dial and can become the limiting stress", () => {
    const healthy = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.6, { pestDiseaseSeverity: 0 }));
    const sick = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.6, { pestDiseaseSeverity: 0.9 }));
    expect(sick.stress.pestDisease).toBeCloseTo(0.9, 5);
    expect(sick.biology.leafFraction + sick.biology.stemFraction + sick.biology.rootFraction).toBeLessThan(
      healthy.biology.leafFraction + healthy.biology.stemFraction + healthy.biology.rootFraction,
    );
  });

  it("diseaseLightPenalty reduces growth even with zero pestDiseaseSeverity (a resolved-but-recovering infection)", () => {
    const noPenalty = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.6, { diseaseLightPenalty: 0 }));
    const withPenalty = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.6, { diseaseLightPenalty: 0.8 }));
    expect(withPenalty.biology.leafFraction).toBeLessThan(noPenalty.biology.leafFraction);
  });

  it("directBiomassLossFraction removes existing foliage on top of any growth this day", () => {
    const grown = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.6));
    const eaten = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.6, { directEffects: { ...NEUTRAL_DIRECT_EFFECTS, directBiomassLossFraction: 0.5 } }));
    expect(eaten.biology.leafFraction).toBeLessThan(grown.biology.leafFraction);
    expect(eaten.biology.stemFraction).toBeLessThan(grown.biology.stemFraction);
    // Root biomass is untouched by direct foliage loss — pests/blight eat
    // leaves/stems, not roots (root rot instead reduces root FUNCTION
    // upstream in daily-step-orchestrator.ts, not biomass here).
    expect(eaten.biology.rootFraction).toBeCloseTo(grown.biology.rootFraction, 10);
  });

  it("weedCompetitionPenalty and energyIncomePenalty both suppress growth via growthPenalty/energyIncome, not the Liebig dial set", () => {
    const neutral = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.6));
    const weedy = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.6, { directEffects: { ...NEUTRAL_DIRECT_EFFECTS, weedCompetitionPenalty: 0.3 } }));
    const sapped = stepDailyGrowth(SPECIES, FRESH_BIOLOGY, weather(), env(0.6, { directEffects: { ...NEUTRAL_DIRECT_EFFECTS, energyIncomePenalty: 0.5 } }));
    expect(weedy.biology.leafFraction).toBeLessThan(neutral.biology.leafFraction);
    expect(sapped.biology.leafFraction).toBeLessThan(neutral.biology.leafFraction);
    // Neither channel touches the Liebig stress-dial combination.
    expect(weedy.stress.pestDisease).toBe(0);
    expect(sapped.stress.pestDisease).toBe(0);
  });
});
