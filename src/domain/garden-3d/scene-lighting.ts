// Pure translation from real sun position + today's weather (both on
// GardenSnapshot.environment, grid-cell-service.ts) into the 3D scene's
// three lights — replaces GardenScene3D.tsx's previous hardcoded static
// values, which were untied to time-of-day or cloud cover entirely. Kept
// out of the component so it's unit-testable without a WebGL context.

import type { DayNightPhase } from "@/domain/lighting/day-night-lifecycle";

export interface SceneLightingInput {
  sunAltitudeRad: number;
  sunAzimuthRad: number;
  phase: DayNightPhase;
  cloudCoverPct: number;
  isSnowDay: boolean;
}

export interface SceneLighting {
  sunPosition: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  hemisphereIntensity: number;
  hemisphereSkyColor: string;
  // Passed through from the input so downstream scene elements that key off
  // day/night (e.g. GardenScene3D's string-light bulb glow) don't need their
  // own separate `phase` prop threaded in alongside `lighting`.
  phase: DayNightPhase;
}

// suncalc's azimuth (see sun-times.ts's computeSunPosition, suncalc 2.x's
// degrees-clockwise-from-north convention converted to radians there) has
// no relationship to the GLB's local axes — docs/Sprig3D.glb carries no
// compass metadata, the same gap cell-node-mapping.ts's header notes for
// bed left/right. This is a stated scene convention, not a derivation:
// compass north is mapped onto the scene's -Z axis, matching the model's
// default load orientation.
const SCENE_NORTH_YAW_RAD = 0;
const SUN_DISTANCE = 30;
// Keeps the directional light a few degrees above the horizon even when
// the real sun has set, so silhouettes/shadows still read as directional
// moonlight rather than the light snapping to a flat, shadowless angle.
const MIN_LIGHT_ALTITUDE_RAD = 0.05;

const BASE_SUN_INTENSITY = 1.4;
const BASE_AMBIENT_INTENSITY = 0.6;
const BASE_HEMISPHERE_INTENSITY = 0.35;
const NIGHT_SUN_INTENSITY = 0.08;
const NIGHT_AMBIENT_INTENSITY = 0.22;

const PHASE_SUN_COLOR: Record<DayNightPhase, string> = {
  DAWN: "#ffb27a",
  DAY: "#fff6e5",
  DUSK: "#ffb27a",
  NIGHT: "#8fa4c8",
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function computeSceneLighting(input: SceneLightingInput): SceneLighting {
  const cloud01 = clamp01(input.cloudCoverPct / 100);
  const aboveHorizon = input.sunAltitudeRad > 0;

  const yaw = SCENE_NORTH_YAW_RAD + input.sunAzimuthRad;
  const liftedAltitude = Math.max(input.sunAltitudeRad, MIN_LIGHT_ALTITUDE_RAD);
  const horizontalRadius = SUN_DISTANCE * Math.cos(liftedAltitude);
  const sunPosition: [number, number, number] = [
    horizontalRadius * Math.sin(yaw),
    Math.max(SUN_DISTANCE * Math.sin(liftedAltitude), 2),
    horizontalRadius * Math.cos(yaw),
  ];

  // Cloud cover dims but never blacks out the scene — a stormy noon still
  // reads as an overcast day, not a night, matching the architecture doc's
  // real-weather-affects-perceived-light intent without losing visibility.
  const sunIntensity = aboveHorizon ? BASE_SUN_INTENSITY * (1 - 0.75 * cloud01) : NIGHT_SUN_INTENSITY;
  const ambientIntensity = aboveHorizon ? BASE_AMBIENT_INTENSITY * (1 - 0.35 * cloud01) : NIGHT_AMBIENT_INTENSITY;
  const hemisphereIntensity = aboveHorizon ? BASE_HEMISPHERE_INTENSITY : BASE_HEMISPHERE_INTENSITY * 0.5;

  return {
    sunPosition,
    sunColor: PHASE_SUN_COLOR[input.phase],
    sunIntensity,
    ambientColor: input.isSnowDay ? "#dfe8f2" : "#ffffff",
    ambientIntensity,
    hemisphereIntensity,
    hemisphereSkyColor: input.phase === "NIGHT" ? "#2a3550" : "#bcd4e6",
    phase: input.phase,
  };
}
