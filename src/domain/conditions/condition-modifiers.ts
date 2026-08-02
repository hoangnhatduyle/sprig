// The shared vocabulary behind BOTH conditions modes — real, persistent
// equipment (bed-condition-override-service.ts) and the ephemeral what-if
// preview (whatif-projection-service.ts) — so "what does +40% light mean"
// is answered in exactly one place instead of two divergent
// implementations. See the architecture doc's §19.

import type { DailyWeather } from "@/domain/weather/weather-provider";

export interface ConditionModifiers {
  lightMultiplier: number; // 1 = unchanged; <1 = shade; >1 = supplemental light
  rainMultiplier: number; // 1 = unchanged; <1 = rain cover; >1 = more precipitation reaching soil
}

export const NEUTRAL_MODIFIERS: ConditionModifiers = { lightMultiplier: 1, rainMultiplier: 1 };

export function combineModifiers(a: ConditionModifiers, b: ConditionModifiers): ConditionModifiers {
  return {
    lightMultiplier: a.lightMultiplier * b.lightMultiplier,
    rainMultiplier: a.rainMultiplier * b.rainMultiplier,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// `rainMultiplier` deliberately means precipitation reaching the soil, not
// irrigation — manual/automatic watering stays a separate inflow term in
// the water bucket (src/domain/soil). A rain cover blocks sky water; a
// drip line adds hose water; keeping them distinct keeps the water math
// legible and avoids double-counting.
//
// `lightMultiplier` is expressed as an effective-cloud-cover adjustment
// (less light = more effective cloud, more light = less effective cloud),
// bounded so it can shift a day at most between "totally overcast" and
// "perfectly clear" — a grow light's benefit saturates at clear-sky
// equivalent rather than exceeding natural full sun. Extending the growth
// engine to model supplemental light beyond that ceiling is a later-phase
// refinement, not needed for shade cloth / grow light / rain cover.
export function applyConditionModifiers(daily: DailyWeather, modifiers: ConditionModifiers): DailyWeather {
  const cloudMultiplier = clamp(2 - modifiers.lightMultiplier, 0, 2);
  return {
    ...daily,
    cloudCoverPct: clamp(daily.cloudCoverPct * cloudMultiplier, 0, 100),
    precipitationMm: Math.max(0, daily.precipitationMm * modifiers.rainMultiplier),
  };
}
