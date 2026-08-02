"use client";

// Renders a bed's active pest OR predator population as a small hovering
// swarm — a bed-scoped counterpart to WeatherParticles.tsx's garden-wide
// rain/snow, positioned/sized from the same BedExtent BedEquipment.tsx
// uses. Uses drei's <Sparkles>, already an installed dependency. Reused
// for both pest and predator swarms (GardenScene3D.tsx renders one of
// each, at different heights, so a released ladybug population is visible
// distinct from the pests it's hunting).

import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import type { PestSwarmVisual } from "@/domain/garden-3d/pest-swarm-3d";
import type { BedExtent } from "@/domain/garden-3d/bed-extent-3d";

// Default height for a pest swarm; GardenScene3D.tsx passes a taller
// offset for the predator swarm so the two clouds don't perfectly overlap.
export const PEST_SWARM_HEIGHT_ABOVE_BED = 0.35;
export const PREDATOR_SWARM_HEIGHT_ABOVE_BED = 0.65;
// Never intercepts a raycast — same rule as WeatherParticles.tsx/
// BedEquipment.tsx: GardenScene3D.tsx's cell-click detection depends on the
// per-cell overlay mesh being the closest raycast hit.
const NO_RAYCAST = () => null;

export interface PestSwarmProps {
  extent: BedExtent;
  visual: PestSwarmVisual | null;
  reducedMotion: boolean;
  heightAboveBed?: number;
}

export function PestSwarm({ extent, visual, reducedMotion, heightAboveBed = PEST_SWARM_HEIGHT_ABOVE_BED }: PestSwarmProps) {
  const width = extent.maxX - extent.minX;
  const depth = extent.maxZ - extent.minZ;
  const scale = useMemo<[number, number, number]>(
    () => [Math.max(width, 0.2), 0.4, Math.max(depth, 0.2)],
    [width, depth],
  );
  const dpr = useThree((state) => state.viewport.dpr);

  // Reduced motion: no swarm at all rather than a static frozen cloud —
  // same a11y rule as WeatherParticles.tsx (a non-animating swarm reads as
  // a rendering bug, not a deliberate choice).
  if (!visual || reducedMotion) {
    return null;
  }

  return (
    <Sparkles
      count={visual.count}
      scale={scale}
      size={visual.size}
      speed={visual.speed}
      color={visual.color}
      position={[extent.centerX, extent.topY + heightAboveBed, extent.centerZ]}
      raycast={NO_RAYCAST}
    >
      {/* Overrides drei's default Sparkles material to add toneMapped=false
          — its fragment shader always includes tonemapping_fragment, so at
          night the same dim-exposure problem GardenScene3D.tsx's string-
          light bulb glow already solved this way would otherwise wash the
          swarm's color out to near-invisible. */}
      <sparklesImplMaterial transparent pixelRatio={dpr} depthWrite={false} toneMapped={false} />
    </Sparkles>
  );
}
