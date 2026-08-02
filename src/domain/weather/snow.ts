// Climate-gated snow (architecture doc §3: "climate-zone-gated ... visual-
// only + growth-halt in early phases, not real snowpack hydrology"). There
// is no separate ClimateZone table in this codebase (procedural-weather-provider.ts's
// own header notes that's deferred) — "climate-gated" here means gated by
// that day's own WeatherDay values instead: a day only reads as snow if its
// temperature and precipitation actually say so, which is already exactly
// equivalent to a monthly-normals gate without needing the extra table.
//
// Deliberately just a pure predicate, not a rendering/visual subsystem.
// Wired into the client-facing read model via weather-service.ts's
// getWeatherDayView (SPEC-SURFACE-001), which computes WeatherDayView.isSnowDay
// from this predicate — the 2D weather banner and 3D particle system both
// key off that field rather than re-deriving the temp/precip check.

import type { DailyWeather } from "./weather-provider";

export function isSnowDay(weather: DailyWeather): boolean {
  return weather.tempLowC <= 0 && weather.precipitationMm > 0;
}
