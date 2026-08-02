// The GLB's string-light bulbs (StringLight_Zig*_Bulb_* nodes,
// docs/Sprig3D.glb) carry a fixed, baked emissiveStrength — the same value
// day or night, so they never visibly "turn on" as the scene gets dark.
// This is the pure day/night -> glow-overlay-intensity mapping GardenScene3D
// renders an emissive overlay sphere from (mirrors the STATUS_TINT/Cell_
// overlay technique in that file), rather than mutating the primitive
// scene's own materials, which this codebase's own GLTF-loading convention
// disallows (see GardenScene3D.tsx's header).

import type { DayNightPhase } from "@/domain/lighting/day-night-lifecycle";

export interface StringLightGlow {
  visible: boolean;
  emissiveIntensity: number;
}

// A real timer-driven string light comes on once it starts getting dark and
// stays on until full daylight returns (DUSK/NIGHT/DAWN), not just during
// the single darkest phase — DAY is the only phase it's off in.
const GLOW_BY_PHASE: Record<DayNightPhase, StringLightGlow> = {
  DAY: { visible: false, emissiveIntensity: 0 },
  DAWN: { visible: true, emissiveIntensity: 1.1 },
  DUSK: { visible: true, emissiveIntensity: 1.1 },
  NIGHT: { visible: true, emissiveIntensity: 2.4 },
};

export function stringLightGlowForPhase(phase: DayNightPhase): StringLightGlow {
  return GLOW_BY_PHASE[phase];
}
