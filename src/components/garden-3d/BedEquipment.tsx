"use client";

// Real meshes for installed bed equipment (BedConditionOverride, see
// src/domain/conditions/) — previously this data existed only as a text
// list in ConditionsPanel.tsx with zero visual representation anywhere.
// Built entirely from three.js primitives (no new assets/Blender work —
// Plant.tsx already established this project's plants are procedural; this
// extends the same approach to equipment).

import { DoubleSide } from "three";
import type { EquipmentRenderState } from "./garden-3d-adapter";
import type { BedExtent } from "@/domain/garden-3d/bed-extent-3d";

// Every mesh here must never win a raycast — GardenScene3D.tsx's header
// explains cell selection depends on the per-cell overlay mesh being the
// closest hit; equipment floating above the grid would otherwise silently
// break clicking whichever cells it covers.
const NO_RAYCAST = () => null;

const CLOTH_HEIGHT_ABOVE_BED = 0.9;
const LIGHT_HEIGHT_ABOVE_BED = 1.2;
const COVER_HEIGHT_ABOVE_BED = 0.6;
const MARGIN = 0.3;

function ShadeCloth({ extent, intensity }: { extent: BedExtent; intensity: number }) {
  const width = extent.maxX - extent.minX + MARGIN * 2;
  const depth = extent.maxZ - extent.minZ + MARGIN * 2;
  const y = extent.topY + CLOTH_HEIGHT_ABOVE_BED;
  const corners: Array<[number, number]> = [
    [extent.minX - MARGIN, extent.minZ - MARGIN],
    [extent.maxX + MARGIN, extent.minZ - MARGIN],
    [extent.minX - MARGIN, extent.maxZ + MARGIN],
    [extent.maxX + MARGIN, extent.maxZ + MARGIN],
  ];
  return (
    <group>
      <mesh position={[extent.centerX, y, extent.centerZ]} raycast={NO_RAYCAST}>
        <boxGeometry args={[width, 0.03, depth]} />
        <meshStandardMaterial color="#3f4a3a" transparent opacity={0.2 + intensity * 0.5} side={DoubleSide} />
      </mesh>
      {corners.map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, y / 2, z]} raycast={NO_RAYCAST}>
          <cylinderGeometry args={[0.04, 0.04, y, 6]} />
          <meshStandardMaterial color="#6b5a44" />
        </mesh>
      ))}
    </group>
  );
}

function GrowLight({ extent, intensity }: { extent: BedExtent; intensity: number }) {
  const y = extent.topY + LIGHT_HEIGHT_ABOVE_BED;
  return (
    <group position={[extent.centerX, y, extent.centerZ]}>
      <mesh raycast={NO_RAYCAST}>
        <boxGeometry args={[0.4, 0.12, 0.4]} />
        <meshStandardMaterial color="#8f8570" emissive="#ffd9a0" emissiveIntensity={0.5 + intensity} />
      </mesh>
      {/* No castShadow: the scene configures no shadow map today
          (GardenScene3D.tsx's static lights never set one either) — adding
          one here would be a silent, hard-to-diagnose perf cliff. */}
      <spotLight
        position={[0, 0, 0]}
        target-position={[extent.centerX, extent.topY, extent.centerZ]}
        angle={0.6}
        penumbra={0.5}
        distance={extent.topY - y + 4}
        intensity={2 + intensity * 3}
        color="#ffd9a0"
      />
      <pointLight intensity={0.3 + intensity * 0.5} distance={2} color="#ffd9a0" />
    </group>
  );
}

function RainCover({ extent, intensity }: { extent: BedExtent; intensity: number }) {
  const y = extent.topY + COVER_HEIGHT_ABOVE_BED;
  const spanX = extent.maxX - extent.minX + MARGIN * 2;
  const spanZ = extent.maxZ - extent.minZ + MARGIN * 2;
  // Orients the arch along the bed's longer axis so it reads as a roof
  // spanning the bed, not a barrel sitting across its short side.
  const alongX = spanX >= spanZ;
  const archLength = alongX ? spanX : spanZ;
  const archRadius = (alongX ? spanZ : spanX) / 2;
  return (
    <group position={[extent.centerX, y, extent.centerZ]} rotation={[0, alongX ? Math.PI / 2 : 0, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} raycast={NO_RAYCAST}>
        <cylinderGeometry args={[archRadius, archRadius, archLength, 12, 1, true, 0, Math.PI]} />
        <meshStandardMaterial color="#d8dde0" transparent opacity={0.15 + intensity * 0.35} side={DoubleSide} />
      </mesh>
      {[-archLength / 2 + 0.15, archLength / 2 - 0.15].map((offset) => (
        <mesh key={offset} position={[offset, -archRadius / 2, 0]} raycast={NO_RAYCAST}>
          <cylinderGeometry args={[0.03, 0.03, archRadius, 6]} />
          <meshStandardMaterial color="#6b5a44" />
        </mesh>
      ))}
    </group>
  );
}

export interface BedEquipmentProps {
  extent: BedExtent;
  equipment: readonly EquipmentRenderState[];
}

export function BedEquipment({ extent, equipment }: BedEquipmentProps) {
  return (
    <>
      {equipment.map((override) => {
        if (override.kind === "SHADE_CLOTH") {
          return <ShadeCloth key={override.id} extent={extent} intensity={override.intensity} />;
        }
        if (override.kind === "GROW_LIGHT") {
          return <GrowLight key={override.id} extent={extent} intensity={override.intensity} />;
        }
        return <RainCover key={override.id} extent={extent} intensity={override.intensity} />;
      })}
    </>
  );
}
