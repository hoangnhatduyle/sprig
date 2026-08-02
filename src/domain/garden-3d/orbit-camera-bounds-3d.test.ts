import { describe, expect, it } from "vitest";
import {
  GARDEN_3D_ORBIT_BOUNDS,
  garden3dCameraDistance,
} from "./orbit-camera-bounds-3d";

describe("garden3dCameraDistance", () => {
  it("keeps the reference framing on landscape canvases", () => {
    expect(garden3dCameraDistance(4 / 3)).toBe(16);
    expect(garden3dCameraDistance(16 / 9)).toBe(16);
  });

  it("moves back on narrow canvases without exceeding the orbit bounds", () => {
    expect(garden3dCameraDistance(1)).toBeGreaterThan(16);
    expect(garden3dCameraDistance(0.5)).toBe(GARDEN_3D_ORBIT_BOUNDS.maxDistance);
  });

  it("falls back to a valid reference distance for unusable aspect values", () => {
    expect(garden3dCameraDistance(0)).toBe(16);
    expect(garden3dCameraDistance(Number.NaN)).toBe(16);
  });
});
