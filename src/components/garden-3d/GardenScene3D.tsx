"use client";

// The GLB-based interactive twin's scene: loads docs/Sprig3D.glb (served
// from public/models/) and renders it completely untouched via <primitive>,
// then layers 64 fully declarative overlay meshes on top - one per
// Cell_<A-H><1-8> node, reusing that node's own geometry (so the overlay sits
// exactly where the artist placed the cell) with a color/opacity driven by
// ordinary JSX props instead of imperative Three.js mutation. This keeps the
// whole component free of refs/effects that mutate scene objects, which
// React Compiler's lint (react-hooks/immutability, set-state-in-effect)
// disallows - and matches how the existing procedural GardenScene.tsx
// already drives material color declaratively.
//
// The overlay sits a hair above the original (invisible) hit-target mesh, so
// with this scene's mostly-overhead orbit camera it's reliably the closer
// raycast hit - clicks/hovers are handled per-overlay-mesh directly, with no
// need to fall back to bubbling + name-matching against the primitive.

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Mesh, Vector3, type BufferGeometry } from "three";
import type { CellStatus } from "@/domain/grid/planting-lifecycle";
import { bedExtentsFromPlacements } from "@/domain/garden-3d/bed-extent-3d";
import type { BedSide } from "@/domain/garden-3d/cell-node-mapping";
import { GARDEN_3D_ORBIT_BOUNDS } from "@/domain/garden-3d/orbit-camera-bounds-3d";
import type { PrecipitationVisual } from "@/domain/garden-3d/weather-visuals";
import type { SceneLighting } from "@/domain/garden-3d/scene-lighting";
import type { PestSwarmVisual } from "@/domain/garden-3d/pest-swarm-3d";
import { stringLightGlowForPhase } from "@/domain/garden-3d/string-light-glow";
import { Plant } from "@/components/viewer/Plant";
import { BedEquipment } from "./BedEquipment";
import { WeatherParticles } from "./WeatherParticles";
import { PestSwarm, PREDATOR_SWARM_HEIGHT_ABOVE_BED } from "./PestSwarm";
import type { CellRenderState, EquipmentRenderState } from "./garden-3d-adapter";

const MODEL_URL = "/models/Sprig3D.glb";
const CELL_NODE_PATTERN = /^Cell_[A-H][1-8]$/;
// The GLB's own ground mesh (Ground_15x11ft, material "MulchGround") only
// covers the mulch patio directly under the pergola/beds — everywhere else
// in the camera's orbit (up to GARDEN_3D_ORBIT_BOUNDS.maxDistance) had
// nothing to render, so the viewport's CSS background (--color-scene-bg)
// showed through instead of a yard. This is a large procedural lawn plane
// underneath that patio, the same "no new assets/Blender work, three.js
// primitives" approach BedEquipment.tsx already established for equipment.
// Centered on GARDEN_3D_ORBIT_BOUNDS.target's x/z (which is itself the
// mulch patio's own center) and sized well past maxDistance so orbiting or
// panning never reveals a bare edge.
const GRASS_PLANE_SIZE = 120;
const GRASS_Y = -0.01;
const GRASS_COLOR = "#5c7a3f";
// Matches every bulb on the pergola's six zig-zag runs (StringLight_Zig1..6,
// Bulb_0..5 each) — see string-light-glow.ts's header for why these need a
// separate glow overlay rather than mutating the baked GLB material.
const BULB_NODE_PATTERN = /^StringLight_Zig\d+_Bulb_\d+$/;
const BULB_GLOW_RADIUS = 0.035;
const BULB_GLOW_COLOR = "#ffd166";
// Overlay meshes must never win a raycast — same reasoning as
// BedEquipment.tsx's NO_RAYCAST: a bulb floating near a cell would otherwise
// silently break clicking/hovering whichever cell it's closest to.
const NO_RAYCAST = () => null;

// Hand-picked hex approximations of status-display.ts's oklch tokens (sage
// green ramp for planted -> growing, amber for harvested): three.js's
// Color can't parse oklch() strings, so these mirror the same hues rather
// than resolving the CSS custom properties at runtime.
export const STATUS_TINT: Record<CellStatus, string> = {
  EMPTY: "#d8d3c8",
  PLANTED: "#bcdcae",
  GERMINATED: "#93c67f",
  GROWING: "#5e9c4f",
  HARVESTED: "#dcb877",
  REMOVED: "#c9a9a0",
};
const BASE_OPACITY = 0.4;
const SELECTED_OPACITY = 0.78;
const SELECTED_COLOR = "#c9773f";
// Lifts the overlay just above the coplanar original hit-target mesh so the
// two don't z-fight, and so the overlay - being marginally closer to this
// scene's mostly-overhead camera - wins raycasting over the untouched
// original underneath it.
const OVERLAY_LIFT = 0.003;

interface CellPlacement {
  nodeName: string;
  geometry: BufferGeometry;
  x: number;
  y: number;
  z: number;
}

interface BulbPlacement {
  nodeName: string;
  x: number;
  y: number;
  z: number;
}

export interface GardenScene3DProps {
  cellStates: ReadonlyMap<string, CellRenderState>;
  lighting: SceneLighting;
  weatherVisual: PrecipitationVisual | null;
  reducedMotion: boolean;
  equipmentBySide: ReadonlyMap<BedSide, EquipmentRenderState[]>;
  pestSwarmBySide: ReadonlyMap<BedSide, PestSwarmVisual | null>;
  predatorSwarmBySide: ReadonlyMap<BedSide, PestSwarmVisual | null>;
  onCellClick?: (nodeName: string) => void;
  onCellHover?: (nodeName: string | null) => void;
}

export function GardenScene3D({
  cellStates,
  lighting,
  weatherVisual,
  reducedMotion,
  equipmentBySide,
  pestSwarmBySide,
  predatorSwarmBySide,
  onCellClick,
  onCellHover,
}: GardenScene3DProps) {
  const { scene } = useGLTF(MODEL_URL);

  // Read-only derivation from the model: which meshes are cell hit-targets
  // (their geometry, reused never mutated, and real-world placement) and
  // which are string-light bulbs (just their placement, for the glow
  // overlay below) — one traversal for both, recomputed only if the loaded
  // model itself changes.
  const { placements, bulbPlacements } = useMemo(() => {
    // Guarantees matrixWorld is current before reading it below, rather than
    // assuming the loader already resolved it for a scene that hasn't been
    // mounted into a rendered tree yet.
    scene.updateMatrixWorld(true);
    const cells: CellPlacement[] = [];
    const bulbs: BulbPlacement[] = [];
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return;
      }
      if (CELL_NODE_PATTERN.test(object.name)) {
        object.geometry.computeBoundingBox();
        const center = new Vector3();
        object.geometry.boundingBox?.getCenter(center);
        center.applyMatrix4(object.matrixWorld);
        cells.push({ nodeName: object.name, geometry: object.geometry, x: center.x, y: center.y, z: center.z });
        return;
      }
      if (BULB_NODE_PATTERN.test(object.name)) {
        object.geometry.computeBoundingBox();
        const center = new Vector3();
        object.geometry.boundingBox?.getCenter(center);
        center.applyMatrix4(object.matrixWorld);
        bulbs.push({ nodeName: object.name, x: center.x, y: center.y, z: center.z });
      }
    });
    return { placements: cells, bulbPlacements: bulbs };
  }, [scene]);

  // Reuses the same placements memo buildCellRenderStates' overlay meshes
  // are keyed off, so equipment mesh positioning can never disagree with
  // where the cells themselves render.
  const bedExtents = useMemo(() => bedExtentsFromPlacements(placements), [placements]);
  const bulbGlow = stringLightGlowForPhase(lighting.phase);

  return (
    <>
      <ambientLight intensity={lighting.ambientIntensity} color={lighting.ambientColor} />
      <directionalLight position={lighting.sunPosition} intensity={lighting.sunIntensity} color={lighting.sunColor} />
      <hemisphereLight
        intensity={lighting.hemisphereIntensity}
        color={lighting.hemisphereSkyColor}
        groundColor="#5b4636"
      />
      <mesh
        position={[GARDEN_3D_ORBIT_BOUNDS.target.x, GRASS_Y, GARDEN_3D_ORBIT_BOUNDS.target.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={NO_RAYCAST}
      >
        <planeGeometry args={[GRASS_PLANE_SIZE, GRASS_PLANE_SIZE]} />
        <meshStandardMaterial color={GRASS_COLOR} />
      </mesh>
      <WeatherParticles visual={weatherVisual} reducedMotion={reducedMotion} />
      {[...bedExtents.entries()].map(([bedSide, extent]) => {
        const equipment = equipmentBySide.get(bedSide);
        if (!equipment || equipment.length === 0) {
          return null;
        }
        return <BedEquipment key={bedSide} extent={extent} equipment={equipment} />;
      })}
      {[...bedExtents.entries()].map(([bedSide, extent]) => (
        <PestSwarm key={`pest-${bedSide}`} extent={extent} visual={pestSwarmBySide.get(bedSide) ?? null} reducedMotion={reducedMotion} />
      ))}
      {[...bedExtents.entries()].map(([bedSide, extent]) => (
        <PestSwarm
          key={`predator-${bedSide}`}
          extent={extent}
          visual={predatorSwarmBySide.get(bedSide) ?? null}
          reducedMotion={reducedMotion}
          heightAboveBed={PREDATOR_SWARM_HEIGHT_ABOVE_BED}
        />
      ))}
      <primitive object={scene} />
      {placements.map((placement) => {
        const state = cellStates.get(placement.nodeName);
        const color = state ? (state.isSelected ? SELECTED_COLOR : STATUS_TINT[state.status]) : STATUS_TINT.EMPTY;
        const opacity = state ? (state.isSelected ? SELECTED_OPACITY : BASE_OPACITY) : 0;
        return (
          <group key={placement.nodeName}>
            <mesh
              geometry={placement.geometry}
              position={[0, OVERLAY_LIFT, 0]}
              onClick={(event) => {
                event.stopPropagation();
                onCellClick?.(placement.nodeName);
              }}
              onPointerOver={(event) => {
                event.stopPropagation();
                onCellHover?.(placement.nodeName);
              }}
              onPointerOut={(event) => {
                event.stopPropagation();
                onCellHover?.(null);
              }}
            >
              <meshStandardMaterial color={color} opacity={opacity} transparent depthWrite={false} />
            </mesh>
            {state && (
              <group position={[0, placement.y, 0]}>
                <Plant
                  status={state.status}
                  growth={state.growth}
                  x={placement.x}
                  z={placement.z}
                  seed={Math.abs(placement.x * 7.3 + placement.z * 3.1)}
                />
              </group>
            )}
          </group>
        );
      })}
      {bulbGlow.visible &&
        bulbPlacements.map((bulb) => (
          <mesh key={bulb.nodeName} position={[bulb.x, bulb.y, bulb.z]} raycast={NO_RAYCAST}>
            <sphereGeometry args={[BULB_GLOW_RADIUS, 8, 8]} />
            {/* toneMapped={false} keeps the glow a punchy, saturated warm
                color regardless of the renderer's tone mapping — otherwise
                the same dim night exposure that dulls everything else in
                the scene would dull this too, defeating the point. */}
            <meshStandardMaterial
              color={BULB_GLOW_COLOR}
              emissive={BULB_GLOW_COLOR}
              emissiveIntensity={bulbGlow.emissiveIntensity}
              toneMapped={false}
            />
          </mesh>
        ))}
    </>
  );
}

useGLTF.preload(MODEL_URL);
