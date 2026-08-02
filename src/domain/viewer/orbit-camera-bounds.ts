// NC-SPRIG-ORBIT-CAMERA-BOUNDS / AC-6: the orbit camera must never navigate
// away from the garden beds into empty/undefined space. This is the pure
// clamp the 3D scene's OrbitControls limits are derived from — kept as a
// plain function (not buried in controls config) so the bound itself is
// testable without a WebGL context.
//
// Spherical convention matches three.js: `distance` is the radius from the
// orbit target, `polarAngle` is measured down from +Y (0 = straight overhead,
// PI/2 = level with the ground plane), `azimuthAngle` is the horizontal turn.

import { InvalidOrbitCameraBoundsError } from "./errors";

export interface OrbitCameraTarget {
  x: number;
  y: number;
  z: number;
}

export interface OrbitCameraBounds {
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  target: OrbitCameraTarget;
}

export interface OrbitCameraState {
  distance: number;
  azimuthAngle: number;
  polarAngle: number;
}

const FULL_TURN = Math.PI * 2;

// The garden scene's actual limits: close enough to read a single cell, far
// enough to frame both 4x8 beds, and stopped just short of the horizon so the
// camera can never drop below the ground plane and look up at nothing.
//
// maxDistance is sized off the scene's own extent (a single 4x8 bed is
// roughly 2.5x4.5 world units — see viewer-scene-layout.ts's CELL_PITCH
// math), not a round number: too generous a max let the bed shrink to a
// speck with the ground plane's edge and empty container background filling
// most of the frame at full zoom-out — technically "bounded", but not
// actually keeping the beds framed, which is the bound's actual intent.
export const GARDEN_ORBIT_BOUNDS: OrbitCameraBounds = {
  minDistance: 2.5,
  // Bumped from 8, then 11: with two beds side by side (~5.9 wide x 4.5
  // deep), 8 didn't leave enough headroom to fit the full width at a narrow
  // (mobile-portrait-ish) canvas aspect. 12 keeps the garden fittable down to
  // roughly a 0.8 aspect (see Viewer3D.tsx's INITIAL_CAMERA comment for the
  // rotation-invariant distance math this and the initial framing are both
  // sized from — the camera orbits freely, so the bound has to hold at every
  // azimuth, not just the angle it happened to be checked at).
  maxDistance: 12,
  minPolarAngle: 0.15,
  // Was PI/2 - 0.05 (~87 degrees, nearly eye-level): at the scene's default
  // distance that put the camera low enough for the bed to shrink to a thin
  // horizon sliver with the empty container background filling most of the
  // frame above it — the same "technically bounded, not actually framed"
  // problem maxDistance's own tuning above already fixed, just on the other
  // axis. ~72 degrees keeps the beds themselves in frame at every legal
  // polar angle.
  maxPolarAngle: 1.25,
  target: { x: 0, y: 0, z: 0 },
};

function assertUsableBounds(bounds: OrbitCameraBounds): void {
  const { minDistance, maxDistance, minPolarAngle, maxPolarAngle } = bounds;
  const allFinite = [minDistance, maxDistance, minPolarAngle, maxPolarAngle].every((value) =>
    Number.isFinite(value),
  );
  if (!allFinite || minDistance > maxDistance || minPolarAngle > maxPolarAngle) {
    throw new InvalidOrbitCameraBoundsError(
      "Orbit camera bounds describe no reachable camera position (inverted or non-finite limits).",
    );
  }
}

// Clamps to [min, max], collapsing NaN to `min` rather than propagating it.
// A malformed drag/scroll delta (a divide-by-zero in a pinch handler, a
// dropped frame producing NaN) must resolve to a valid in-scene camera, not
// corrupt the view into undefined space. +/-Infinity clamps naturally.
function clampFinite(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

// Horizontal orbit is unbounded — the user can keep turning all the way
// around the beds — but the returned value is normalized into one turn
// ([0, 2*PI)) so repeated dragging can't accumulate an ever-growing angle.
function normalizeAzimuth(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const wrapped = ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
  // Floating-point rounding on a tiny negative input can land exactly on
  // FULL_TURN, which is outside the half-open range.
  return wrapped >= FULL_TURN ? 0 : wrapped;
}

// Returns a NEW camera state inside `bounds`; never mutates the input. An
// already-in-bounds state passes through with identical values.
export function clampOrbitCamera(
  state: OrbitCameraState,
  bounds: OrbitCameraBounds,
): OrbitCameraState {
  assertUsableBounds(bounds);
  return {
    distance: clampFinite(state.distance, bounds.minDistance, bounds.maxDistance),
    azimuthAngle: normalizeAzimuth(state.azimuthAngle),
    polarAngle: clampFinite(state.polarAngle, bounds.minPolarAngle, bounds.maxPolarAngle),
  };
}

// Cartesian position for a spherical camera state, clamped into bounds on the
// way through — so the scene's *initial* camera comes from the same bound the
// controls enforce afterwards, rather than a separately-tuned literal that
// could start the view outside the garden and only snap back on first drag.
// three.js spherical convention: polar measured down from +Y.
export function orbitCameraPosition(
  state: OrbitCameraState,
  bounds: OrbitCameraBounds,
): [number, number, number] {
  const { distance, azimuthAngle, polarAngle } = clampOrbitCamera(state, bounds);
  const horizontal = distance * Math.sin(polarAngle);
  return [
    bounds.target.x + horizontal * Math.sin(azimuthAngle),
    bounds.target.y + distance * Math.cos(polarAngle),
    bounds.target.z + horizontal * Math.cos(azimuthAngle),
  ];
}
