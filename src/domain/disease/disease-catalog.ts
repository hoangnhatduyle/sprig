// Curated disease config (architecture doc §9) — mirrors
// species-catalog.ts's/companion-catalog.ts's "config, not code that changes
// per disease" philosophy: a new disease should only require a new entry
// here, never new disease-service.ts code. `hostSusceptibility` keys are
// species-catalog.ts `key`s; a species missing from the map is simply never
// a host for that disease (susceptibility 0).

import type { DailyWeather } from "@/domain/weather/weather-provider";

export type DiseaseKind = "FUNGAL" | "BACTERIAL" | "VIRAL";

// Different diseases visibly manifest differently (architecture doc §9):
// mildew reduces light interception, root rot reduces effective root
// function, blight removes biomass directly. All three scale linearly with
// the infection's current severity (disease-service.ts's effectForActiveInfection).
export interface DiseaseEffect {
  lightPenalty: number;
  rootFunctionPenalty: number;
  biomassLossFractionPerDay: number;
}

export interface FavorableConditionInputs {
  weather: DailyWeather;
  soilMoistureFraction: number;
  overwaterDial: number;
}

export interface DiseaseDefinition {
  key: string;
  displayName: string;
  kind: DiseaseKind;
  hostSusceptibility: Readonly<Record<string, number>>;
  baseInfectionRate: number;
  // Severity growth per simulated day while conditions stay favorable, and
  // decay per day once they don't — real fungal issues often stall or
  // resolve under dry weather / early intervention (architecture doc §9/§15
  // "recoverable, not a death sentence").
  severityGrowthRate: number;
  severityDecayRate: number;
  effect: DiseaseEffect;
  favorableCondition: (inputs: FavorableConditionInputs) => number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Powdery mildew: the architecture doc's own worked example — high
// humidity + moderate temperature. Cucurbits and nightshades are its most
// visible real-world hosts; lettuce is only mildly susceptible.
const powderyMildew: DiseaseDefinition = {
  key: "powdery-mildew",
  displayName: "Powdery Mildew",
  kind: "FUNGAL",
  hostSusceptibility: { cucumber: 0.7, tomato: 0.4, "bell-pepper": 0.3, lettuce: 0.15 },
  baseInfectionRate: 0.05,
  severityGrowthRate: 0.12,
  severityDecayRate: 0.15,
  effect: { lightPenalty: 0.35, rootFunctionPenalty: 0, biomassLossFractionPerDay: 0.005 },
  favorableCondition: ({ weather }) => {
    const humidityMatch = clamp01((weather.humidityPct - 60) / 30);
    const meanTempC = (weather.tempHighC + weather.tempLowC) / 2;
    const tempMatch = clamp01(1 - Math.abs(meanTempC - 24) / 12);
    return humidityMatch * tempMatch;
  },
};

// Root rot: sustained overwatering + poor drainage, not a "too much water"
// instant rule — driven by the SAME overwater stress dial
// (stress-service.ts) that already models duration-not-instant waterlogging,
// so this disease's onset naturally lines up with an already-legible signal.
const rootRot: DiseaseDefinition = {
  key: "root-rot",
  displayName: "Root Rot",
  kind: "FUNGAL",
  hostSusceptibility: {
    tomato: 0.5,
    "bell-pepper": 0.5,
    cucumber: 0.4,
    lettuce: 0.3,
    carrot: 0.35,
    "pole-bean": 0.4,
    marigold: 0.3,
    "generic-bush": 0.4,
  },
  baseInfectionRate: 0.06,
  severityGrowthRate: 0.1,
  severityDecayRate: 0.08,
  effect: { lightPenalty: 0, rootFunctionPenalty: 0.5, biomassLossFractionPerDay: 0.002 },
  favorableCondition: ({ overwaterDial, soilMoistureFraction }) => clamp01(overwaterDial * 0.7 + soilMoistureFraction * 0.3),
};

// Blight: high humidity + wet foliage (approximated by same-day
// precipitation) + warm temperature — the doc's own third worked example,
// hitting nightshades hardest and doing direct biomass damage rather than
// an indirect efficiency penalty.
const blight: DiseaseDefinition = {
  key: "blight",
  displayName: "Blight",
  kind: "FUNGAL",
  hostSusceptibility: { tomato: 0.55, "bell-pepper": 0.4 },
  baseInfectionRate: 0.04,
  severityGrowthRate: 0.1,
  severityDecayRate: 0.12,
  effect: { lightPenalty: 0.1, rootFunctionPenalty: 0, biomassLossFractionPerDay: 0.02 },
  favorableCondition: ({ weather }) => {
    const humidityMatch = clamp01((weather.humidityPct - 65) / 25);
    const wetFoliageMatch = weather.precipitationMm > 0 ? 1 : 0.2;
    const meanTempC = (weather.tempHighC + weather.tempLowC) / 2;
    const tempMatch = clamp01(1 - Math.abs(meanTempC - 24) / 10);
    return humidityMatch * wetFoliageMatch * tempMatch;
  },
};

export const DISEASE_DEFINITIONS: readonly DiseaseDefinition[] = [powderyMildew, rootRot, blight];

const DISEASE_BY_KEY = new Map(DISEASE_DEFINITIONS.map((disease) => [disease.key, disease]));

export function getDiseaseDefinition(key: string): DiseaseDefinition | undefined {
  return DISEASE_BY_KEY.get(key);
}

// Diseases for which this species is a host at all (susceptibility > 0) —
// what disease-service.ts's daily infection roll iterates over per planting.
export function diseasesForSpecies(speciesKey: string): readonly DiseaseDefinition[] {
  return DISEASE_DEFINITIONS.filter((disease) => (disease.hostSusceptibility[speciesKey] ?? 0) > 0);
}
