"use client";

// Renders today's rain/snow as falling particles over the whole garden
// (weather is garden-global, not per-bed — see WeatherBanner.tsx's 2D
// counterpart). Uses drei's <Sparkles>, already an installed dependency —
// no new package, no hand-rolled particle system.

import { useMemo } from "react";
import { Sparkles } from "@react-three/drei";
import type { PrecipitationVisual } from "@/domain/garden-3d/weather-visuals";
import { GARDEN_3D_ORBIT_BOUNDS } from "@/domain/garden-3d/orbit-camera-bounds-3d";

const PARTICLE_FIELD_HEIGHT = 8;
// Never intercepts a raycast — GardenScene3D.tsx's own header explains cell
// clicks resolve via "closest raycast hit" against the per-cell overlay
// meshes; a particle field sitting above the whole garden would otherwise
// be able to win that hit test and silently break cell selection.
const NO_RAYCAST = () => null;

export interface WeatherParticlesProps {
  visual: PrecipitationVisual | null;
  reducedMotion: boolean;
}

export function WeatherParticles({ visual, reducedMotion }: WeatherParticlesProps) {
  const target = GARDEN_3D_ORBIT_BOUNDS.target;
  // GARDEN_3D_ORBIT_BOUNDS.maxDistance is sized to the model's real garden
  // extent (see that file's own comment) — reused here instead of a second
  // hand-picked field size, so the particle volume always covers the beds
  // regardless of future model/scene rescaling.
  const fieldWidth = GARDEN_3D_ORBIT_BOUNDS.maxDistance;

  const scale = useMemo<[number, number, number]>(
    () => [fieldWidth, PARTICLE_FIELD_HEIGHT, fieldWidth],
    [fieldWidth],
  );

  // Reduced motion: no particles at all rather than a static frozen field —
  // a non-animating rain effect would read as a rendering bug, not a
  // deliberate accessibility choice.
  if (!visual || reducedMotion) {
    return null;
  }

  return (
    <Sparkles
      count={visual.count}
      scale={scale}
      size={visual.size}
      speed={visual.speed}
      opacity={visual.opacity}
      color={visual.color}
      noise={visual.noise}
      position={[target.x, target.y + PARTICLE_FIELD_HEIGHT / 2, target.z]}
      raycast={NO_RAYCAST}
    />
  );
}
