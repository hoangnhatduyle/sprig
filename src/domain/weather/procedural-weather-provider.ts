// A seeded, seasonally-weighted daily weather draw — deliberately NOT a full
// path-dependent Markov chain (yesterday's condition doesn't bias today's):
// every day's weather is a pure, independently-reproducible function of
// (location, date). That's what lets the growth engine's catch-up step
// (src/domain/growth/catch-up-service.ts) replay or skip days in any order
// without first needing to have generated the days in between — see the
// architecture doc's §3/§14 on determinism. Real regional precipitation
// patterns (a Mediterranean dry summer, a monsoon season) aren't modeled;
// that needs an explicit climate-zone config, deferred to a later phase.

import type { DailyWeather, WeatherLocation, WeatherProvider } from "./weather-provider";

const CONDITIONS = ["CLEAR", "PARTLY_CLOUDY", "CLOUDY", "RAIN", "STORM"] as const;
type Condition = (typeof CONDITIONS)[number];

// mulberry32 — a small, fast, deterministic PRNG. Not cryptographic (no need
// to be): only used so the exact same (location, date) always produces the
// exact same weather.
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / (24 * 60 * 60 * 1000));
}

// A rough seasonal sinusoid, not a real climate model (the architecture
// doc's §1 explicitly abstracts real atmospheric physics away): amplitude
// grows with distance from the equator, and the peak falls near day 200
// (~July 19) in the northern hemisphere, ~182 days offset in the southern.
function seasonalMeanHighC(latitude: number, doy: number): number {
  const amplitude = 6 + Math.min(Math.abs(latitude), 60) * 0.4;
  const peakDay = latitude < 0 ? 200 - 182.5 : 200;
  const angle = ((doy - peakDay) / 365) * 2 * Math.PI;
  return 18 + amplitude * Math.cos(angle);
}

// A deterministic integer combining the calendar date and a salt string, so
// different weather facets (condition draw vs. within-condition jitter)
// don't all derive from the exact same random stream.
function dateSeed(date: Date, salt: string): number {
  const base = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000;
  let hash = base;
  for (let i = 0; i < salt.length; i += 1) {
    hash = (hash * 31 + salt.charCodeAt(i)) | 0;
  }
  return hash;
}

const CONDITION_EFFECTS: Record<
  Condition,
  { cloudCoverPct: number; precipChance: number; precipMm: [number, number] }
> = {
  CLEAR: { cloudCoverPct: 10, precipChance: 0, precipMm: [0, 0] },
  PARTLY_CLOUDY: { cloudCoverPct: 40, precipChance: 0.1, precipMm: [0, 2] },
  CLOUDY: { cloudCoverPct: 80, precipChance: 0.25, precipMm: [0, 4] },
  RAIN: { cloudCoverPct: 90, precipChance: 1, precipMm: [2, 15] },
  STORM: { cloudCoverPct: 95, precipChance: 1, precipMm: [10, 35] },
};

// Seasonally nudged condition weights: a crude stand-in for "wetter season"
// (wetnessFactor closer to 1 shifts weight from CLEAR toward RAIN/STORM),
// not a real regional precipitation model.
function conditionWeights(wetnessFactor: number): Record<Condition, number> {
  return {
    CLEAR: 0.4 - 0.15 * wetnessFactor,
    PARTLY_CLOUDY: 0.3,
    CLOUDY: 0.15 + 0.05 * wetnessFactor,
    RAIN: 0.1 + 0.15 * wetnessFactor,
    STORM: 0.05 + 0.05 * wetnessFactor,
  };
}

function pickCondition(random: () => number, wetnessFactor: number): Condition {
  const weights = conditionWeights(wetnessFactor);
  const total = CONDITIONS.reduce((sum, condition) => sum + Math.max(weights[condition], 0), 0);
  let roll = random() * total;
  for (const condition of CONDITIONS) {
    roll -= Math.max(weights[condition], 0);
    if (roll <= 0) {
      return condition;
    }
  }
  return "PARTLY_CLOUDY";
}

export class ProceduralWeatherProvider implements WeatherProvider {
  async getDay(location: WeatherLocation, date: Date): Promise<DailyWeather> {
    const doy = dayOfYear(date);
    const meanHighC = seasonalMeanHighC(location.latitude, doy);
    // Crude northern-hemisphere-style seasonality: slightly wetter near
    // winter. See the file header on why this isn't a real regional model.
    const wetnessFactor = 0.5 + 0.5 * Math.cos(((doy - 30) / 365) * 2 * Math.PI);

    const conditionRandom = mulberry32(dateSeed(date, "condition"));
    const jitterRandom = mulberry32(dateSeed(date, "jitter"));

    const condition = pickCondition(conditionRandom, wetnessFactor);
    const effects = CONDITION_EFFECTS[condition];

    const tempHighC = meanHighC + (jitterRandom() - 0.5) * 6;
    const tempLowC = tempHighC - (6 + jitterRandom() * 4);

    const precipitationMm =
      jitterRandom() < effects.precipChance
        ? effects.precipMm[0] + jitterRandom() * (effects.precipMm[1] - effects.precipMm[0])
        : 0;

    const humidityPct = Math.min(95, Math.max(20, effects.cloudCoverPct * 0.6 + 20 + jitterRandom() * 10));
    const windSpeedKph = 5 + jitterRandom() * (condition === "STORM" ? 35 : 15);

    return {
      date,
      tempHighC,
      tempLowC,
      precipitationMm,
      cloudCoverPct: effects.cloudCoverPct,
      humidityPct,
      windSpeedKph,
      condition,
    };
  }
}
