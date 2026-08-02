// The architecture doc's §17 validation suite, formalized as automated
// vitest tests (Phase 3 roadmap item). Deliberately uses a fixed synthetic
// weather sequence rather than the real procedural provider or the real
// calendar date the test suite happens to run on — §17's whole premise
// ("same seed+date always gives the same weather") is about REPRODUCIBLE
// results, and a test whose outcome depends on what season it's actually
// run in would defeat that. Only two of §17's checks are covered here (see
// SPEC-GROWTH-003.yaml's out_of_scope): the current data model has no
// matureYieldReference-style field yet to validate yield/water-usage
// against real FAO/seed-packet tables.

import { describe, expect, it } from "vitest";
import type { DailyWeather } from "@/domain/weather/weather-provider";
import { NEUTRAL_DIRECT_EFFECTS, stepDailyGrowth, type BiologyState, type SpeciesGrowthParams } from "../growth-engine-service";

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

// A "typical warm growing season" day: comfortable for every seeded
// species' temperature response curve, full sun, ample (but not
// waterlogged) moisture — every simulated day is IDENTICAL, so the only
// thing that varies between species runs is their own SpeciesGrowthParams.
function typicalGrowingSeasonWeather(): DailyWeather {
  return {
    date: new Date("2026-06-15T00:00:00Z"),
    tempHighC: 27,
    tempLowC: 18,
    precipitationMm: 2,
    cloudCoverPct: 15,
    humidityPct: 55,
    windSpeedKph: 8,
    condition: "PARTLY_CLOUDY",
  };
}

function comfortableEnv(overrides: Partial<Parameters<typeof stepDailyGrowth>[3]> = {}) {
  return {
    soilMoistureFraction: 0.6,
    daysNearSaturation: 0,
    baselineLight: "FULL_SUN" as const,
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

// Runs a full "season" (bounded by a max-days safety cap so a mis-tuned
// species can never hang the test suite) and returns the number of
// simulated days until MATURE — undefined if the cap is hit first.
function daysToMature(species: SpeciesGrowthParams, maxDays: number): number | undefined {
  let biology = FRESH_BIOLOGY;
  const weather = typicalGrowingSeasonWeather();
  for (let day = 1; day <= maxDays; day += 1) {
    biology = stepDailyGrowth(species, biology, weather, comfortableEnv()).biology;
    if (biology.phenologyStage === "MATURE") return day;
  }
  return undefined;
}

// TOMATO from species-catalog.ts (gddToMaturity 1100, baseTempC 10) vs.
// LETTUCE (gddToMaturity 350, baseTempC 4) — a slow-maturing fruiting crop
// vs. a fast-maturing leafy green, the architecture doc's own worked
// species-differentiation example (§1/§16).
const TOMATO: SpeciesGrowthParams = {
  baseTempC: 10,
  gddToGerminate: 50,
  gddToVegetative: 200,
  gddToFlowering: 450,
  gddToFruiting: 650,
  gddToMaturity: 1100,
  heatStressThresholdC: 32,
  coldStressThresholdC: 10,
  droughtComfortFraction: 0.55,
  lightNeedFraction: 0.6,
  windLodgingThresholdKph: 38,
  baseNutrientDemand: 1,
  pollinationDependency: "SELF",
};

const LETTUCE: SpeciesGrowthParams = {
  baseTempC: 4,
  gddToGerminate: 20,
  gddToVegetative: 100,
  gddToFlowering: 900,
  gddToFruiting: 950,
  gddToMaturity: 350,
  heatStressThresholdC: 24,
  coldStressThresholdC: 2,
  droughtComfortFraction: 0.5,
  lightNeedFraction: 0.4,
  windLodgingThresholdKph: 45,
  baseNutrientDemand: 1,
  pollinationDependency: "SELF",
};

describe("SPEC-GROWTH-003 §17 validation — relative days-to-maturity ordering", () => {
  it("a low-GDD-threshold leafy green reaches MATURE measurably sooner than a high-threshold fruiting crop under identical weather", () => {
    const lettuceDays = daysToMature(LETTUCE, 200);
    const tomatoDays = daysToMature(TOMATO, 200);
    expect(lettuceDays).toBeDefined();
    expect(tomatoDays).toBeDefined();
    expect(lettuceDays!).toBeLessThan(tomatoDays!);
  });

  it("the fallback archetype (species-catalog.ts's FALLBACK_SPECIES_KEY params) reaches MATURE within a bounded season, never stalling forever", () => {
    // Hand-copied from species-catalog.ts's SPECIES_SEEDS fallback entry —
    // kept as plain literals rather than a DB round trip so this whole
    // suite stays a pure, zero-I/O, deterministic vitest run.
    const fallback: SpeciesGrowthParams = {
      baseTempC: 8,
      gddToGerminate: 45,
      gddToVegetative: 180,
      gddToFlowering: 400,
      gddToFruiting: 600,
      gddToMaturity: 900,
      heatStressThresholdC: 30,
      coldStressThresholdC: 8,
      droughtComfortFraction: 0.5,
      lightNeedFraction: 0.6,
      windLodgingThresholdKph: 45,
      baseNutrientDemand: 1,
      pollinationDependency: "SELF",
    };
    expect(daysToMature(fallback, 250)).toBeDefined();
  });
});

describe("SPEC-GROWTH-003 §17 validation — survival under sustained drought", () => {
  it("14 simulated days with zero soil moisture produces severe, not indifferent, cumulative stress", () => {
    let biology = FRESH_BIOLOGY;
    const weather = typicalGrowingSeasonWeather();
    for (let day = 0; day < 14; day += 1) {
      biology = stepDailyGrowth(TOMATO, biology, weather, comfortableEnv({ soilMoistureFraction: 0 })).biology;
    }
    expect(biology.cumulativeStress).toBeGreaterThan(0.7);
    expect(biology.waterContentIndex).toBeLessThan(0.3);
  });

  it("the same 14-day span under ample moisture keeps cumulative stress low by comparison", () => {
    let biology = FRESH_BIOLOGY;
    const weather = typicalGrowingSeasonWeather();
    for (let day = 0; day < 14; day += 1) {
      biology = stepDailyGrowth(TOMATO, biology, weather, comfortableEnv({ soilMoistureFraction: 0.6 })).biology;
    }
    expect(biology.cumulativeStress).toBeLessThan(0.2);
  });
});
