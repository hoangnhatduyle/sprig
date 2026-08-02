// Discriminable domain errors — lets callers branch on error type instead of
// regex-matching messages (mirrors src/domain/grid/errors.ts).

class ViewerDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

// Rejected 3D-viewer-mode hop (SPEC-VIEWER-001 "3D viewer mode"). Re-exported
// from ./viewer-mode-lifecycle so callers of the pure lifecycle table can
// import the error it throws from the same module.
export class ViewerModeTransitionError extends ViewerDomainError {}

// Orbit bounds that describe no reachable camera position at all (inverted or
// non-finite limits). Clamping against them would silently produce a camera
// pointing at nothing, which is exactly what NC-SPRIG-ORBIT-CAMERA-BOUNDS
// exists to prevent.
export class InvalidOrbitCameraBoundsError extends ViewerDomainError {}
