// Shared WebGL feature-detection for every 3D viewer surface (the procedural
// simulation viewer, and the GLB-based interactive twin). jsdom and
// locked-down browsers have no WebGL context; mounting <Canvas> there throws
// inside three's renderer, so callers feature-detect first and fall back to
// a text/DOM readout instead of assuming support.
//
// Memoized at module scope because this is read on every render via
// useSyncExternalStore, whose snapshot must be cheap and stable — probing a
// throwaway <canvas> each time would be neither.

import { useSyncExternalStore } from "react";

let webGlSupport: boolean | null = null;

function hasWebGlSupport(): boolean {
  if (webGlSupport !== null) {
    return webGlSupport;
  }
  // The constructor check comes first because it is cheap and, unlike
  // getContext(), doesn't make jsdom log an unimplemented-method notice.
  if (typeof window === "undefined" || !("WebGLRenderingContext" in window)) {
    return false; // Not cached: the server snapshot must not pin the client's.
  }
  try {
    const probe = document.createElement("canvas");
    webGlSupport = Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  } catch {
    webGlSupport = false;
  }
  return webGlSupport;
}

// WebGL support is an external, never-changing fact about the browser, so it
// is read as an external store rather than mirrored into state via an
// effect: the server (and the first client render, for hydration parity)
// sees false, the client settles on the real answer.
const NEVER_CHANGES = () => () => {};

export function useWebGlSupport(): boolean {
  return useSyncExternalStore(NEVER_CHANGES, hasWebGlSupport, () => false);
}
