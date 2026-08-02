import { describe, expect, it } from "vitest";
import type { DailyWeather } from "@/domain/weather/weather-provider";
import { getDiseaseDefinition } from "./disease-catalog";
import {
  conditionMatchForDisease,
  effectForActiveInfection,
  infectionProbability,
  neighborInfectionPressureFromCounts,
  rollForNewInfection,
  stepDiseaseSeverity,
} from "./disease-service";

const MILDEW = getDiseaseDefinition("powdery-mildew")!;
const ROOT_ROT = getDiseaseDefinition("root-rot")!;

function weather(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return {
    date: new Date("2026-07-01T00:00:00Z"),
    tempHighC: 26,
    tempLowC: 18,
    precipitationMm: 0,
    cloudCoverPct: 40,
    humidityPct: 80,
    windSpeedKph: 5,
    condition: "PARTLY_CLOUDY",
    ...overrides,
  };
}

describe("conditionMatchForDisease", () => {
  it("mildew favors high humidity and moderate temperature", () => {
    const favorable = conditionMatchForDisease(MILDEW, {
      weather: weather({ humidityPct: 90, tempHighC: 26, tempLowC: 22 }),
      soilMoistureFraction: 0.5,
      overwaterDial: 0,
    });
    const unfavorable = conditionMatchForDisease(MILDEW, {
      weather: weather({ humidityPct: 30, tempHighC: 40, tempLowC: 35 }),
      soilMoistureFraction: 0.5,
      overwaterDial: 0,
    });
    expect(favorable).toBeGreaterThan(unfavorable);
  });

  it("root rot is driven by the overwater dial, not humidity", () => {
    const soggy = conditionMatchForDisease(ROOT_ROT, {
      weather: weather({ humidityPct: 10 }),
      soilMoistureFraction: 1,
      overwaterDial: 1,
    });
    const dry = conditionMatchForDisease(ROOT_ROT, {
      weather: weather({ humidityPct: 90 }),
      soilMoistureFraction: 0.2,
      overwaterDial: 0,
    });
    expect(soggy).toBeGreaterThan(dry);
  });
});

describe("infectionProbability", () => {
  it("is zero for a non-host species", () => {
    const probability = infectionProbability({
      disease: MILDEW,
      conditionMatchValue: 1,
      speciesKey: "carrot",
      resistanceTrait: 0,
      neighborInfectionPressure: 0,
    });
    expect(probability).toBe(0);
  });

  it("rises with neighbor infection pressure", () => {
    const base = infectionProbability({
      disease: MILDEW,
      conditionMatchValue: 0.8,
      speciesKey: "cucumber",
      resistanceTrait: 0,
      neighborInfectionPressure: 0,
    });
    const withNeighbors = infectionProbability({
      disease: MILDEW,
      conditionMatchValue: 0.8,
      speciesKey: "cucumber",
      resistanceTrait: 0,
      neighborInfectionPressure: 1,
    });
    expect(withNeighbors).toBeGreaterThan(base);
  });

  it("resistance trait reduces probability", () => {
    const susceptible = infectionProbability({
      disease: MILDEW,
      conditionMatchValue: 0.8,
      speciesKey: "cucumber",
      resistanceTrait: 0,
      neighborInfectionPressure: 0,
    });
    const resistant = infectionProbability({
      disease: MILDEW,
      conditionMatchValue: 0.8,
      speciesKey: "cucumber",
      resistanceTrait: 0.9,
      neighborInfectionPressure: 0,
    });
    expect(resistant).toBeLessThan(susceptible);
  });
});

describe("rollForNewInfection", () => {
  it("is deterministic for the same (disease, planting, date)", () => {
    const inputs = {
      disease: MILDEW,
      conditionMatchValue: 0.9,
      speciesKey: "cucumber",
      resistanceTrait: 0,
      neighborInfectionPressure: 0,
      cellPlantingId: "planting-1",
      date: new Date("2026-07-04T00:00:00Z"),
    };
    expect(rollForNewInfection(inputs)).toBe(rollForNewInfection({ ...inputs }));
  });

  it("never infects when probability is zero", () => {
    expect(
      rollForNewInfection({
        disease: MILDEW,
        conditionMatchValue: 0,
        speciesKey: "cucumber",
        resistanceTrait: 0,
        neighborInfectionPressure: 0,
        cellPlantingId: "planting-2",
        date: new Date("2026-07-04T00:00:00Z"),
      }),
    ).toBe(false);
  });
});

describe("neighborInfectionPressureFromCounts", () => {
  it("is zero when there are no other plantings", () => {
    expect(neighborInfectionPressureFromCounts(0, 0)).toBe(0);
  });

  it("is the fraction of bed-mates infected", () => {
    expect(neighborInfectionPressureFromCounts(2, 4)).toBe(0.5);
  });
});

describe("stepDiseaseSeverity", () => {
  it("grows severity under favorable conditions", () => {
    const result = stepDiseaseSeverity(0.2, MILDEW, 0.9);
    expect(result.severity).toBeGreaterThan(0.2);
    expect(result.resolved).toBe(false);
  });

  it("decays and resolves under sustained unfavorable conditions from a low starting severity", () => {
    const result = stepDiseaseSeverity(0.05, MILDEW, 0);
    expect(result.severity).toBe(0);
    expect(result.resolved).toBe(true);
  });

  it("decays but does not yet resolve from a high starting severity", () => {
    const result = stepDiseaseSeverity(0.9, MILDEW, 0);
    expect(result.severity).toBeGreaterThan(0);
    expect(result.resolved).toBe(false);
  });
});

describe("effectForActiveInfection", () => {
  it("scales the disease's fixed effect profile by severity", () => {
    const half = effectForActiveInfection(MILDEW, 0.5);
    const full = effectForActiveInfection(MILDEW, 1);
    expect(half.lightPenalty).toBeCloseTo(full.lightPenalty / 2, 5);
    expect(half.severityDialValue).toBe(0.5);
  });

  it("root rot affects root function, not light", () => {
    const effect = effectForActiveInfection(ROOT_ROT, 1);
    expect(effect.rootFunctionPenalty).toBeGreaterThan(0);
    expect(effect.lightPenalty).toBe(0);
  });
});
