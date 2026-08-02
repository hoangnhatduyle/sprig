// Orbit camera bounds for the GLB-based interactive twin (GardenScene3D).
// Deliberately separate from src/domain/viewer/orbit-camera-bounds.ts's
// GARDEN_ORBIT_BOUNDS: that bound is tuned to the small procedural scene's
// own coordinate scale (CELL_PITCH=0.5 units/cell). This scene renders
// docs/Sprig3D.glb's real geometry directly, whose cells span roughly
// x=2..13, z=-9..-1 (decoded from the model's own Cell_* node bounding
// boxes) - reusing the procedural bound's numbers here would clip the real
// garden or leave the camera orbiting mostly empty space. The clamp math
// itself (clampOrbitCamera/orbitCameraPosition) is scene-agnostic, so it's
// imported rather than reimplemented.

import type { OrbitCameraBounds } from "@/domain/viewer/orbit-camera-bounds";

// Center of the model's real garden extent: x midpoint of 2..13, z midpoint
// of -9..-1.
export const GARDEN_3D_ORBIT_BOUNDS: OrbitCameraBounds = {
  minDistance: 4,
  // Sized off the model's own bounding circle (half-width ~5.5, half-depth
  // ~4) plus room to see the surrounding trellis/fence/bench context the
  // artist modeled, not just the beds.
  maxDistance: 22,
  minPolarAngle: 0.15,
  maxPolarAngle: 1.3,
  target: { x: 7.5, y: 0.9, z: -5 },
};

const REFERENCE_ASPECT = 4 / 3;
const REFERENCE_DISTANCE = 16;

// The model is substantially wider than it is deep. Keep the reference
// framing on landscape canvases, then move back as the canvas narrows so the
// fence and both beds remain visible instead of being clipped horizontally.
export function garden3dCameraDistance(aspect: number): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : REFERENCE_ASPECT;
  const aspectAdjustedDistance =
    safeAspect < REFERENCE_ASPECT ? REFERENCE_DISTANCE * (REFERENCE_ASPECT / safeAspect) : REFERENCE_DISTANCE;

  return Math.min(
    GARDEN_3D_ORBIT_BOUNDS.maxDistance,
    Math.max(GARDEN_3D_ORBIT_BOUNDS.minDistance, aspectAdjustedDistance),
  );
}
