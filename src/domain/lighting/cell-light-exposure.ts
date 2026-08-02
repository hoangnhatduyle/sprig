// Backs AC-5/AC-8 and NC-SPRIG-LIGHT-FOLLOWS-TIME: per-cell natural light
// exposure baked/interpolated from the captured sun/shadow study (docs/
// Exterior Design.pdf p.5-8, p.26) — out of scope for must-have is computing
// real-time shadows from actual 3D blockout geometry, so this is a fixed
// lookup table, not a physics simulation.
//
// The two BaselineLight buckets (from SPEC-GRID-001) get distinct curves —
// FULL_SUN cells run brighter and hold peak exposure longer through midday;
// PARTIAL_SHADE cells are dampened throughout — which is what makes this a
// captured-pattern model rather than "a generic/uniform sun model" applied
// identically to every cell (the failure case AC-5 explicitly rules out).

import type { GardenLocationCoords } from "./sun-times";
import { InvalidBaselineLightError } from "./errors";

export type BaselineLight = "PARTIAL_SHADE" | "FULL_SUN";

// hour-of-day (0-23, local mean solar time) -> exposure in [0, 1].
type ExposureCurve = ReadonlyMap<number, number>;

const FULL_SUN_CURVE: ExposureCurve = new Map([
  [5, 0.0],
  [7, 0.3],
  [9, 0.7],
  [12, 1.0],
  [15, 0.9],
  [17, 0.5],
  [19, 0.1],
  [21, 0.0],
]);

const PARTIAL_SHADE_CURVE: ExposureCurve = new Map([
  [5, 0.0],
  [7, 0.1],
  [9, 0.3],
  [12, 0.55],
  [15, 0.5],
  [17, 0.25],
  [19, 0.05],
  [21, 0.0],
]);

const CURVES: Record<BaselineLight, ExposureCurve> = {
  FULL_SUN: FULL_SUN_CURVE,
  PARTIAL_SHADE: PARTIAL_SHADE_CURVE,
};

// Linear interpolation between the curve's bracketing keyframes; clamps to
// 0 outside the curve's first/last defined hour rather than extrapolating.
// Iterates [hour, value] pairs together (rather than looking values back up
// by key) so there's no point where a key lookup could plausibly miss.
function interpolateCurve(curve: ExposureCurve, hourFraction: number): number {
  const entries = [...curve.entries()].sort((a, b) => a[0] - b[0]);
  const [firstHour] = entries[0];
  const [lastHour] = entries[entries.length - 1];
  if (hourFraction <= firstHour || hourFraction >= lastHour) {
    return 0;
  }
  for (let i = 0; i < entries.length - 1; i++) {
    const [h0, v0] = entries[i];
    const [h1, v1] = entries[i + 1];
    if (hourFraction >= h0 && hourFraction <= h1) {
      const t = (hourFraction - h0) / (h1 - h0);
      return v0 + (v1 - v0) * t;
    }
  }
  return 0;
}

// Local MEAN SOLAR hour-of-day for `at`, derived from longitude alone (15
// degrees of longitude per hour of solar time) — deliberately NOT
// `at.getHours()`. Date.getHours() reads the *host process's* system
// timezone, which has nothing to do with GardenLocation's real-world
// position: a light-exposure calculation that used it would silently
// return different results depending on where the app happens to be
// deployed/tested, for the exact same simulated instant and the exact same
// garden. Using only UTC-based Date methods plus the location's longitude
// keeps this deterministic and location-driven, consistent with how
// sun-times.ts already treats time as an absolute instant combined with
// lat/long, never a host-local wall-clock reading.
function localSolarHourFraction(longitude: number, at: Date): number {
  const offsetMs = (longitude / 15) * 60 * 60 * 1000;
  const localInstant = new Date(at.getTime() + offsetMs);
  return localInstant.getUTCHours() + localInstant.getUTCMinutes() / 60;
}

// Exposure for one cell at one instant, in [0, 1], for the garden at
// `location`. The curve encodes "time of day" as local mean solar hour, not
// `at`'s calendar date or the host machine's clock.
export function computeCellLightExposure(
  baselineLight: BaselineLight,
  location: GardenLocationCoords,
  at: Date,
): number {
  const curve = CURVES[baselineLight];
  if (!curve) {
    throw new InvalidBaselineLightError(
      `computeCellLightExposure: unknown BaselineLight "${String(baselineLight)}".`,
    );
  }
  const hourFraction = localSolarHourFraction(location.longitude, at);
  return interpolateCurve(curve, hourFraction);
}
