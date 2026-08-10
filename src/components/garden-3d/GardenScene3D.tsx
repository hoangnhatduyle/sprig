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
import { Color, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry, type Material } from "three";
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
import type { CellRenderState, EquipmentRenderState, RainBarrelRenderState } from "./garden-3d-adapter";

const MODEL_URL = "/models/Sprig3Dv2.glb";
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
// docs/Sprig3Dv2.glb added its own baked whole-yard grass plane
// (Grass_WholeYard, ~y=-0.01) that sits almost exactly on top of the
// pre-existing baked mulch patio (Ground_15x11ft, ~y=0) — two near-coincident
// ground planes in the same footprint z-fight (flickers green/brown) rather
// than one cleanly winning. It also fully duplicates the procedural grass
// plane above. Hidden via the same narrow visibility-toggle precedent as the
// rain barrel WaterLevel mesh below, restoring the original (correct)
// procedural-grass-under/mulch-patio-on-top look.
const GRASS_WHOLE_YARD_NODE_NAME = "Grass_WholeYard";
// Matches every bulb on the pergola's six zig-zag runs (StringLight_Zig1..6,
// Bulb_0..5 each) — see string-light-glow.ts's header for why these need a
// separate glow overlay rather than mutating the baked GLB material.
const BULB_NODE_PATTERN = /^StringLight_Zig\d+_Bulb_\d+$/;
const BULB_GLOW_RADIUS = 0.035;
const BULB_GLOW_COLOR = "#ffd166";
// Matches each barrel's WaterLevel/Body node pair (docs/Sprig3Dv2.glb) — see
// rain-barrel-fill.ts's header for why the WaterLevel mesh, baked at a fixed
// 50% fill, is hidden and replaced by a scaled overlay rather than left
// visible alongside it.
const RAIN_BARREL_WATER_NODE_PATTERN = /^RainBarrel_(\d+)_WaterLevel$/;
const RAIN_BARREL_BODY_NODE_PATTERN = /^RainBarrel_(\d+)_Body$/;
// The Body material is authored at alpha 0.88 (alphaMode BLEND) — technically
// translucent, but high enough it reads as solid, hiding the whole point of
// the water-level overlay above. Same "hide original, render a fresh overlay"
// technique as WaterLevel, reusing the Body's own color/roughness so barrel 1
// and 2 keep their distinct authored finishes. 0.4 (the first attempt at
// "genuinely see-through") overcorrected the other way — against the fence/
// lawn background the wall all but disappeared, leaving only the opaque
// water-level mesh visible and reading as a solid blue cylinder rather than
// a barrel with water in it. This still shows the fill level through the
// wall, just without losing the wall itself.
const RAIN_BARREL_BODY_OVERLAY_OPACITY = 0.65;
// Both SpigotHandle and SpigotStem are authored centered on the barrel's own
// vertical axis (local X/Z span only ±0.07/±0.035, vs. the Body's ±0.875
// radius) rather than offset out to the wall — invisible against the
// originally near-opaque body, but floating inside the barrel now that it's
// genuinely see-through. Same hide-and-reposition technique, moved out to
// the wall along the direction facing the camera's orbit target (a defined,
// explainable "front" rather than an arbitrary axis pick).
const RAIN_BARREL_SPIGOT_NODE_PATTERN = /^RainBarrel_(\d+)_Spigot(?:Handle|Stem)$/;
// Every StandLeg is authored at the same X as its barrel's own center — the
// naming (_<xSign>_<zSign>) implies 4 distinct corners, but X is never
// actually offset, and on barrel 2 two of the four legs are additionally
// translated meters away from their own stand entirely (verified against the
// source GLB). The two legs per barrel that ARE correctly placed sit exactly
// ±0.7 from their StandTop's center in both axes — that's the one
// consistent, correct value in the data, so it's reused here as the target
// inset for all 8 legs rather than four hardcoded per-barrel corrections.
const RAIN_BARREL_STAND_LEG_NODE_PATTERN = /^RainBarrel_(\d+)_StandLeg_(-?1)_(-?1)$/;
const RAIN_BARREL_STAND_TOP_NODE_PATTERN = /^RainBarrel_(\d+)_StandTop$/;
const STAND_LEG_INSET = 0.7;
// Applied on top of the leg's own authored scale, to real-photo-reference
// legs thinner (X/Z only — height is untouched).
const STAND_LEG_THINNESS_FACTOR = 0.6;
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

// bakedFraction is the fill fraction the artist's baked WaterLevel geometry
// itself represents (derived from its own bounding-box height vs. the
// barrel Body's, not hardcoded — see rain-barrel-fill.ts) — the overlay
// scales this reused geometry by targetFraction / bakedFraction so it
// stretches from the correct bottom-anchored pivot to any actual fill level,
// not just the one baked ratio.
interface RainBarrelPlacement {
  yardSlot: number;
  geometry: BufferGeometry;
  material: Material | Material[];
  worldPosition: Vector3;
  bakedFraction: number;
}

interface BarrelBodyPlacement {
  yardSlot: number;
  geometry: BufferGeometry;
  color: Color;
  roughness: number;
  worldPosition: Vector3;
}

interface SpigotPlacement {
  nodeName: string;
  geometry: BufferGeometry;
  material: Material | Material[];
  worldPosition: Vector3;
}

interface StandLegPlacement {
  nodeName: string;
  geometry: BufferGeometry;
  material: Material | Material[];
  worldPosition: Vector3;
  // The raw geometry is a plain unit cube — its actual thin post shape comes
  // entirely from the node's own scale (~0.12 x 0.9 x 0.12), which has to be
  // captured and reapplied explicitly since the overlay mesh is a fresh JSX
  // element, not the original scaled node.
  scale: Vector3;
}

export interface GardenScene3DProps {
  cellStates: ReadonlyMap<string, CellRenderState>;
  lighting: SceneLighting;
  weatherVisual: PrecipitationVisual | null;
  reducedMotion: boolean;
  equipmentBySide: ReadonlyMap<BedSide, EquipmentRenderState[]>;
  pestSwarmBySide: ReadonlyMap<BedSide, PestSwarmVisual | null>;
  predatorSwarmBySide: ReadonlyMap<BedSide, PestSwarmVisual | null>;
  rainBarrelStates: ReadonlyMap<number, RainBarrelRenderState>;
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
  rainBarrelStates,
  onCellClick,
  onCellHover,
}: GardenScene3DProps) {
  const { scene } = useGLTF(MODEL_URL);

  // Read-only derivation from the model: which meshes are cell hit-targets
  // (their geometry, reused never mutated, and real-world placement), which
  // are string-light bulbs (just their placement, for the glow overlay
  // below), and each rain barrel's WaterLevel/Body pair (for the fill
  // overlay below) — one traversal for all three, recomputed only if the
  // loaded model itself changes.
  const { placements, bulbPlacements, rainBarrelPlacements, barrelBodyPlacements, spigotPlacements, standLegPlacements } = useMemo(() => {
    // Guarantees matrixWorld is current before reading it below, rather than
    // assuming the loader already resolved it for a scene that hasn't been
    // mounted into a rendered tree yet.
    scene.updateMatrixWorld(true);
    const cells: CellPlacement[] = [];
    const bulbs: BulbPlacement[] = [];
    const bodyMeshesBySlot = new Map<number, { mesh: Mesh; localHeight: number; radiusXZ: number }>();
    const waterMeshesBySlot = new Map<number, { mesh: Mesh; localHeight: number }>();
    const spigotMeshes: Mesh[] = [];
    const standTopCenterBySlot = new Map<number, Vector3>();
    const standLegMeshes: { mesh: Mesh; yardSlot: number; xSign: number; zSign: number }[] = [];
    scene.traverse((object) => {
      if (object.name === GRASS_WHOLE_YARD_NODE_NAME) {
        object.visible = false;
        return;
      }
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
        return;
      }
      const bodyMatch = RAIN_BARREL_BODY_NODE_PATTERN.exec(object.name);
      if (bodyMatch) {
        object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox;
        bodyMeshesBySlot.set(Number(bodyMatch[1]), {
          mesh: object,
          localHeight: box ? box.max.y - box.min.y : 0,
          radiusXZ: box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 : 0,
        });
        return;
      }
      const waterMatch = RAIN_BARREL_WATER_NODE_PATTERN.exec(object.name);
      if (waterMatch) {
        object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox;
        waterMeshesBySlot.set(Number(waterMatch[1]), {
          mesh: object,
          localHeight: box ? box.max.y - box.min.y : 0,
        });
        return;
      }
      if (RAIN_BARREL_SPIGOT_NODE_PATTERN.test(object.name)) {
        spigotMeshes.push(object);
        return;
      }
      const standTopMatch = RAIN_BARREL_STAND_TOP_NODE_PATTERN.exec(object.name);
      if (standTopMatch) {
        // StandTop itself is correctly centered in the source data (matches
        // its barrel's Body translation) — read only, never hidden/replaced.
        standTopCenterBySlot.set(Number(standTopMatch[1]), new Vector3().setFromMatrixPosition(object.matrixWorld));
        return;
      }
      const standLegMatch = RAIN_BARREL_STAND_LEG_NODE_PATTERN.exec(object.name);
      if (standLegMatch) {
        standLegMeshes.push({
          mesh: object,
          yardSlot: Number(standLegMatch[1]),
          xSign: Number(standLegMatch[2]),
          zSign: Number(standLegMatch[3]),
        });
      }
    });

    const rainBarrels: RainBarrelPlacement[] = [];
    for (const [yardSlot, { mesh, localHeight }] of waterMeshesBySlot) {
      const bodyHeight = bodyMeshesBySlot.get(yardSlot)?.localHeight;
      const bakedFraction = bodyHeight && bodyHeight > 0 ? localHeight / bodyHeight : 0;
      const worldPosition = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
      // The baked WaterLevel mesh fully replaces its own visual role with
      // the React-driven overlay below — left visible, it would show a
      // second, always-50%-full water surface no matter what the overlay
      // renders. This is a narrow, one-time visibility toggle computed
      // alongside the already-precedented scene.updateMatrixWorld(true)
      // mutation above, not a material/color/geometry change, and it's the
      // only way to represent an arbitrary fill level: an additive-only
      // overlay (like the bulb glow) can't make a fixed, already-visible
      // translucent disc appear shorter than its baked height.
      mesh.visible = false;
      rainBarrels.push({ yardSlot, geometry: mesh.geometry, material: mesh.material, worldPosition, bakedFraction });
    }

    const barrelBodies: BarrelBodyPlacement[] = [];
    for (const [yardSlot, { mesh }] of bodyMeshesBySlot) {
      const worldPosition = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const isStandard = sourceMaterial instanceof MeshStandardMaterial;
      // Same narrow visibility toggle as WaterLevel above — the authored
      // body material (alpha 0.88) reads as solid, hiding the water-level
      // overlay it's meant to reveal. Color/roughness are only READ here to
      // keep the overlay visually consistent with each barrel's authored
      // finish, never written back onto the original material.
      mesh.visible = false;
      barrelBodies.push({
        yardSlot,
        geometry: mesh.geometry,
        color: isStandard ? sourceMaterial.color.clone() : new Color("#4d3626"),
        roughness: isStandard ? sourceMaterial.roughness : 0.55,
        worldPosition,
      });
    }

    const spigots: SpigotPlacement[] = [];
    for (const mesh of spigotMeshes) {
      const worldPosition = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const bodyMatch = /^RainBarrel_(\d+)_/.exec(mesh.name);
      const radius = bodyMatch ? bodyMeshesBySlot.get(Number(bodyMatch[1]))?.radiusXZ ?? 0 : 0;
      // Direction from the spigot's own (currently center-of-barrel) position
      // toward the camera's orbit target, constrained to the X axis only (Z
      // dropped) — an explainable "front" rather than an arbitrary +X/-X
      // pick. Both barrels share the same X (13.9) but differ in Z (2.2 vs
      // 3.9), so including the Z component here gave each barrel a slightly
      // different angle and made the two spigots land off-center from each
      // other; zeroing it means both land at the exact horizontal center of
      // the same X-facing wall, at each barrel's own unmodified center Z.
      const towardTarget = new Vector3(GARDEN_3D_ORBIT_BOUNDS.target.x - worldPosition.x, 0, 0);
      if (towardTarget.lengthSq() > 0) {
        towardTarget.normalize();
      }
      const repositioned = worldPosition.clone().addScaledVector(towardTarget, radius);
      // Same narrow visibility toggle as the other rain-barrel fixes — the
      // original sits on the barrel's central axis instead of its wall (see
      // this pattern's own header comment).
      mesh.visible = false;
      spigots.push({ nodeName: mesh.name, geometry: mesh.geometry, material: mesh.material, worldPosition: repositioned });
    }

    const standLegs: StandLegPlacement[] = [];
    for (const { mesh, yardSlot, xSign, zSign } of standLegMeshes) {
      const center = standTopCenterBySlot.get(yardSlot);
      const worldPosition = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const repositioned = center
        ? new Vector3(center.x + xSign * STAND_LEG_INSET, worldPosition.y, center.z + zSign * STAND_LEG_INSET)
        : worldPosition;
      // Same narrow visibility toggle — see this pattern's own header
      // comment on why all 4 legs' X/Z are recomputed from the (correctly
      // placed) StandTop center rather than trusting the authored translation.
      mesh.visible = false;
      standLegs.push({
        nodeName: mesh.name,
        geometry: mesh.geometry,
        material: mesh.material,
        worldPosition: repositioned,
        scale: mesh.scale.clone(),
      });
    }

    return {
      placements: cells,
      bulbPlacements: bulbs,
      rainBarrelPlacements: rainBarrels,
      barrelBodyPlacements: barrelBodies,
      spigotPlacements: spigots,
      standLegPlacements: standLegs,
    };
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
      {standLegPlacements.map((placement) => (
        <mesh
          key={placement.nodeName}
          geometry={placement.geometry}
          material={placement.material}
          position={[placement.worldPosition.x, placement.worldPosition.y, placement.worldPosition.z]}
          scale={[
            placement.scale.x * STAND_LEG_THINNESS_FACTOR,
            placement.scale.y,
            placement.scale.z * STAND_LEG_THINNESS_FACTOR,
          ]}
          raycast={NO_RAYCAST}
        />
      ))}
      {rainBarrelPlacements.map((placement) => {
        const state = rainBarrelStates.get(placement.yardSlot);
        const scaleY =
          state && placement.bakedFraction > 0 ? state.fillFraction / placement.bakedFraction : 0;
        return (
          <mesh
            key={`rainbarrel-${placement.yardSlot}`}
            geometry={placement.geometry}
            material={placement.material}
            position={[placement.worldPosition.x, placement.worldPosition.y, placement.worldPosition.z]}
            scale={[1, scaleY, 1]}
            renderOrder={0}
            raycast={NO_RAYCAST}
          />
        );
      })}
      {barrelBodyPlacements.map((placement) => (
        <mesh
          key={`rainbarrel-body-${placement.yardSlot}`}
          geometry={placement.geometry}
          position={[placement.worldPosition.x, placement.worldPosition.y, placement.worldPosition.z]}
          // Water and Body are both transparent + depthWrite=false, with
          // near-coincident pivots — three.js's transparent-pass sort
          // (painterSortStable, see three.module.js) falls through
          // renderOrder first and only breaks ties by z when renderOrder
          // matches. Left at the default (both 0), the z-tiebreak was
          // landing with Water painted after Body on every frame, so
          // Water's own near-opaque blue simply overwrote Body's pixels
          // regardless of Body's own opacity — which is why raising
          // RAIN_BARREL_BODY_OVERLAY_OPACITY did nothing visible. Forcing
          // Body's renderOrder above Water's guarantees Body always paints
          // last, so its translucent wall blends over the water rather
          // than the other way around.
          renderOrder={1}
          raycast={NO_RAYCAST}
        >
          <meshStandardMaterial
            color={placement.color}
            roughness={placement.roughness}
            transparent
            opacity={RAIN_BARREL_BODY_OVERLAY_OPACITY}
            depthWrite={false}
          />
        </mesh>
      ))}
      {spigotPlacements.map((placement) => (
        <mesh
          key={placement.nodeName}
          geometry={placement.geometry}
          material={placement.material}
          position={[placement.worldPosition.x, placement.worldPosition.y, placement.worldPosition.z]}
          raycast={NO_RAYCAST}
        />
      ))}
    </>
  );
}

useGLTF.preload(MODEL_URL);
