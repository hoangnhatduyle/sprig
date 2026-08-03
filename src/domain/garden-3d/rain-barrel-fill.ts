// The GLB's two rain barrels (RainBarrel_1_WaterLevel/RainBarrel_2_WaterLevel
// nodes, docs/Sprig3Dv2.glb) each carry a WaterLevel child mesh baked at a
// fixed 50% fill height. This is the pure currentGallons/capacityGallons ->
// fill-fraction mapping GardenScene3D renders an overlay cylinder from
// (mirrors string-light-glow.ts's day/night -> glow-overlay mapping), rather
// than mutating the primitive scene's own WaterLevel geometry, which this
// codebase's own GLTF-loading convention disallows (see GardenScene3D.tsx's
// header).

export function rainBarrelFillFraction(currentGallons: number, capacityGallons: number): number {
  if (capacityGallons <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, currentGallons / capacityGallons));
}
