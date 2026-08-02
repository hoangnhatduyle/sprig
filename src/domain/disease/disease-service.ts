// Infection probability, severity progression, and per-day effects for one
// planting's disease state (architecture doc §9). Pure and cheap, same
// no-I/O contract as the rest of the engine: catch-up-service.ts owns all
// persistence (DiseaseInfection rows), this file only computes.
//
// Simplification, documented once here: at most one ACTIVE infection per
// planting at a time (disease-service.ts never proposes a second while one
// is already unresolved) — real plants can have concurrent infections, but
// "one dominant disease at a time" is the same "not per-spore simulation"
// cheapness stance the architecture doc's §9 already commits to.

import type { DailyWeather } from "@/domain/weather/weather-provider";
import { diseasesForSpecies, getDiseaseDefinition, type DiseaseDefinition } from "./disease-catalog";
import { deterministicUnitDraw } from "@/domain/shared/deterministic-random";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Below this, conditions count as "unfavorable" — severity decays instead
// of growing, and can fully resolve if it decays out while still low
// (architecture doc §9: early/dry intervention halts many fungal issues).
const FAVORABLE_CONDITION_THRESHOLD = 0.35;

export interface DiseaseConditionInputs {
  weather: DailyWeather;
  soilMoistureFraction: number;
  overwaterDial: number;
}

export function conditionMatchForDisease(disease: DiseaseDefinition, inputs: DiseaseConditionInputs): number {
  return clamp01(disease.favorableCondition(inputs));
}

// A bed-local proxy for "nearby infected plants raise local probability"
// (architecture doc §9/§11) — the fraction of a planting's bed-mates
// (excluding itself) currently carrying ANY active infection. Snapshotted
// once per catch-up call by catch-up-service.ts (the same "resolved once
// per whole window, not re-resolved per simulated day" treatment already
// established for conditions/ecology modifiers there), not re-derived every
// simulated day.
export function neighborInfectionPressureFromCounts(infectedNeighborCount: number, otherPlantingCount: number): number {
  if (otherPlantingCount <= 0) return 0;
  return clamp01(infectedNeighborCount / otherPlantingCount);
}

export interface InfectionRollInputs {
  disease: DiseaseDefinition;
  conditionMatchValue: number;
  speciesKey: string;
  resistanceTrait: number;
  neighborInfectionPressure: number;
}

// P(infect) = baseRate x conditionMatch x hostSusceptibility x
// (1 + neighborPressure) x (1 - resistanceTrait) — the architecture doc's
// §9 formula verbatim.
export function infectionProbability(inputs: InfectionRollInputs): number {
  const susceptibility = inputs.disease.hostSusceptibility[inputs.speciesKey] ?? 0;
  if (susceptibility <= 0) return 0;
  return clamp01(
    inputs.disease.baseInfectionRate *
      inputs.conditionMatchValue *
      susceptibility *
      (1 + inputs.neighborInfectionPressure) *
      (1 - clamp01(inputs.resistanceTrait)),
  );
}

// Deterministically seeded by (disease, planting, date) so catch-up is
// reproducible whether replayed incrementally or fast-forwarded in one
// batch (architecture doc §14), and so §17's validation suite can assert on
// specific outcomes.
export function rollForNewInfection(inputs: InfectionRollInputs & { cellPlantingId: string; date: Date }): boolean {
  const probability = infectionProbability(inputs);
  if (probability <= 0) return false;
  const draw = deterministicUnitDraw(inputs.date, `disease:${inputs.disease.key}:${inputs.cellPlantingId}`);
  return draw < probability;
}

// Picks which of a species' possible diseases to roll for on a given day,
// in catalog order, stopping at the first that actually infects — cheap and
// deterministic; a planting susceptible to multiple diseases doesn't roll
// for all of them independently every day (a documented simplification, in
// the same spirit as "one active infection at a time").
export function tryInfect(inputs: {
  speciesKey: string;
  resistanceTrait: number;
  neighborInfectionPressure: number;
  conditions: DiseaseConditionInputs;
  cellPlantingId: string;
  date: Date;
}): DiseaseDefinition | null {
  for (const disease of diseasesForSpecies(inputs.speciesKey)) {
    const conditionMatchValue = conditionMatchForDisease(disease, inputs.conditions);
    const infected = rollForNewInfection({
      disease,
      conditionMatchValue,
      speciesKey: inputs.speciesKey,
      resistanceTrait: inputs.resistanceTrait,
      neighborInfectionPressure: inputs.neighborInfectionPressure,
      cellPlantingId: inputs.cellPlantingId,
      date: inputs.date,
    });
    if (infected) return disease;
  }
  return null;
}

export interface SeverityStepResult {
  severity: number;
  resolved: boolean;
}

// Grows toward 1 while conditions stay favorable; decays toward 0
// (potentially resolving the infection) once they don't. Recovery mirrors
// the growth engine's own stress-cumulative-vs-instant distinction
// (architecture doc §8/§15): a severity that was already high doesn't snap
// back to healthy the instant weather turns, it decays gradually.
export function stepDiseaseSeverity(
  currentSeverity: number,
  disease: DiseaseDefinition,
  conditionMatchValue: number,
): SeverityStepResult {
  if (conditionMatchValue >= FAVORABLE_CONDITION_THRESHOLD) {
    return { severity: clamp01(currentSeverity + disease.severityGrowthRate * conditionMatchValue), resolved: false };
  }
  const severity = Math.max(0, currentSeverity - disease.severityDecayRate);
  return { severity, resolved: severity <= 0 };
}

export interface DiseaseInstanceEffect {
  lightPenalty: number;
  rootFunctionPenalty: number;
  biomassLossFraction: number;
  severityDialValue: number;
}

export const NEUTRAL_DISEASE_EFFECT: DiseaseInstanceEffect = {
  lightPenalty: 0,
  rootFunctionPenalty: 0,
  biomassLossFraction: 0,
  severityDialValue: 0,
};

// Scales the disease's fixed per-severity-1.0 effect profile by the
// infection's current severity — this is where "different diseases visibly
// manifest differently" (architecture doc §9) actually happens.
export function effectForActiveInfection(disease: DiseaseDefinition, severity: number): DiseaseInstanceEffect {
  return {
    lightPenalty: disease.effect.lightPenalty * severity,
    rootFunctionPenalty: disease.effect.rootFunctionPenalty * severity,
    biomassLossFraction: disease.effect.biomassLossFractionPerDay * severity,
    severityDialValue: severity,
  };
}

export { getDiseaseDefinition, diseasesForSpecies };
export type { DiseaseDefinition };
