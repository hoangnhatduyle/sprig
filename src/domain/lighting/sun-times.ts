// Real, location-computed sunrise/sunset — the free/keyless external
// dependency named in SPEC-LIGHT-001's external_dependencies: a pure
// astronomical calculation given lat/long/date, no network call. Backs
// NC-SPRIG-DUSK-FROM-REAL-LOCATION and NC-SPRIG-NO-WEATHER-API-IN-MUST-HAVE
// (suncalc computes from lat/long/time only — it has no weather/cloud input
// to depend on).
//
// DayNightCycle itself is never persisted (see the schema.prisma note on
// SPEC-LIGHT-001): computePhase is a pure function of (location, instant),
// re-derived on every read rather than driven by day-night-lifecycle.ts's
// events. That table still documents the one-phase-at-a-time contract this
// function's four-way split must uphold.

import { getPosition, getTimes } from "suncalc";
import type { DayNightPhase } from "./day-night-lifecycle";
import { InvalidGardenLocationError } from "./errors";

export interface GardenLocationCoords {
  latitude: number;
  longitude: number;
}

export interface SunTimes {
  dawn: Date;
  sunrise: Date;
  sunset: Date;
  dusk: Date;
}

function assertValidLocation(location: GardenLocationCoords): void {
  const { latitude, longitude } = location;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new InvalidGardenLocationError(
      `GardenLocation (${latitude}, ${longitude}) is not a valid latitude/longitude pair.`,
    );
  }
}

// civil dawn/dusk (SunCalc's default 'dawn'/'dusk' angle) mark the DAWN and
// DUSK phase boundaries; sunrise/sunset mark DAY. All four come from the
// same location-computed astronomical calculation.
//
// SunCalc types dawn/sunrise/sunset/dusk as Date | null because at polar
// latitudes the sun can stay above or below the horizon all day, so the
// event never occurs (`alwaysUp`/`alwaysDown`). A real garden's
// GardenLocation isn't going to be inside the Arctic/Antarctic Circle, so
// treating a null here as a location-validation failure (rather than
// threading `| null` through every downstream phase/exposure calculation)
// is the right call for this domain, not a cast-away of a real case.
export function computeSunTimes(location: GardenLocationCoords, date: Date): SunTimes {
  assertValidLocation(location);
  const raw = getTimes(date, location.latitude, location.longitude);
  if (!raw.dawn || !raw.sunrise || !raw.sunset || !raw.dusk) {
    throw new InvalidGardenLocationError(
      `GardenLocation (${location.latitude}, ${location.longitude}) has no sunrise/sunset on ${date.toISOString()} (polar day or night) — not a supported garden location.`,
    );
  }
  return { dawn: raw.dawn, sunrise: raw.sunrise, sunset: raw.sunset, dusk: raw.dusk };
}

// Derives the simulated DayNightPhase directly from real, location-computed
// sun times for `at`'s calendar day (NC-SPRIG-DUSK-FROM-REAL-LOCATION) —
// never from a fixed clock hour. `at` before that day's civil dawn is
// NIGHT (still last night, not yet today's DAWN); `at` at/after dusk is
// also NIGHT (tonight).
export function computePhase(location: GardenLocationCoords, at: Date): DayNightPhase {
  const times = computeSunTimes(location, at);
  if (at < times.dawn) return "NIGHT";
  if (at < times.sunrise) return "DAWN";
  if (at < times.sunset) return "DAY";
  if (at < times.dusk) return "DUSK";
  return "NIGHT";
}

export interface SunPosition {
  altitudeRad: number;
  azimuthRad: number;
}

// suncalc's installed major version (2.x) returns getPosition() in DEGREES,
// clockwise from north (0=N, 90=E, 180=S, 270=W) — the compass convention,
// per its own bundled index.d.ts and confirmed against suncalc.cjs's source
// (azimuth()/altitude() both divide by `rad` before returning, unlike the
// older/widely-documented 1.x behavior of radians measured from south).
// This function converts to radians for the rest of the codebase (three.js
// scene-lighting math expects radians) but preserves the north-relative
// convention rather than reinventing it — garden-3d/scene-lighting.ts is
// responsible for mapping compass azimuth onto the GLB's local axes, since
// the model itself carries no compass metadata.
export function computeSunPosition(location: GardenLocationCoords, at: Date): SunPosition {
  assertValidLocation(location);
  const position = getPosition(at, location.latitude, location.longitude);
  return {
    altitudeRad: (position.altitude * Math.PI) / 180,
    azimuthRad: (position.azimuth * Math.PI) / 180,
  };
}
