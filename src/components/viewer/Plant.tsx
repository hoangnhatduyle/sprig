"use client";

// A procedural, species-differentiated plant visual — extracted out of
// GardenScene.tsx so the GLB-based interactive twin (GardenScene3D.tsx) can
// reuse it. Driven by the growth engine's own state (src/domain/growth)
// rather than the coarse SPEC-GRID-001 CellStatus: height/shape/color are
// continuous functions of live biomass fractions, not a fixed lookup table
// per lifecycle stage. This is the "always-works baseline" tier from the
// architecture doc's §16 species-visual design — parametric geometry driven
// by a species' growthHabit, so a brand-new species the user just typed in
// renders correctly with zero art assets, before any curated 3D model tier
// is layered on top later.

import { DoubleSide } from "three";
import type { CellStatus } from "@/domain/grid/planting-lifecycle";
import { HEALTH_BAND_HEX, STRESS_DIAL_HEX, healthBand } from "@/components/garden/stress-display";

// The stress ring must never win a raycast — same rule as GardenScene3D.tsx's
// per-cell overlay meshes and BedEquipment.tsx's equipment meshes: it sits
// visually above the ground, and clicking a cell must always resolve to the
// cell overlay, not an incidental decoration mesh.
const NO_RAYCAST = () => null;

export type GrowthHabit = "UPRIGHT_BUSH" | "VINING" | "ROSETTE_LEAFY" | "ROOT_CROP";

export interface PlantGrowthProps {
  phenologyStage: string;
  growthHabit: GrowthHabit;
  leafFraction: number;
  stemFraction: number;
  rootFraction: number;
  flowerFraction: number;
  fruitFraction: number;
  waterContentIndex: number;
  cumulativeStress: number;
  primaryColor: string;
  // 0..1, from CellEnvironmentState.micronutrientIndexFraction (Phase 2) —
  // drives the chlorosis tint below. A cell-level value duplicated onto
  // every planting's growth view (grid-cell-service.ts) rather than a
  // separate prop, since this component already treats `growth` as its one
  // source of visual truth.
  micronutrientIndexFraction: number;
  // Whichever of stress-service.ts's 9 dials was dominant on the plant's
  // last simulated day, or null — see stress-display.ts's STRESS_DIAL_HEX.
  // Previously unused by this component (only CellPicker's text readout
  // surfaced it); the base ring below is its 3D counterpart.
  dominantStressDial: string | null;
  // The planting's first active disease infection, or null — see
  // grid-cell-service.ts's PlantingGrowthView.infection. Feeds
  // foliageColor()'s lerp chain below (leaf-spot tint), the 3D counterpart
  // of CellPicker's infection severity meter.
  infection: { diseaseKey: string; severity: number } | null;
}

export interface PlantProps {
  status: CellStatus;
  growth: PlantGrowthProps | null;
  x: number;
  z: number;
  seed: number;
}

// Per-habit ceiling on rendered height (scene units) — a stylized relative
// scale, not matureHeightCm mapped 1:1 (a lettuce and a tomato aren't drawn
// at real relative scale, or the lettuce would be nearly invisible next to
// it; the point is silhouette differentiation, not architectural accuracy).
const HABIT_MAX_HEIGHT: Record<GrowthHabit, number> = {
  UPRIGHT_BUSH: 0.28,
  VINING: 0.4,
  ROSETTE_LEAFY: 0.12,
  // Mostly below-ground — the visible crown is deliberately the shortest
  // archetype, matching a real root crop's silhouette (carrot, radish).
  ROOT_CROP: 0.08,
};

const FALLBACK_HEIGHT: Record<CellStatus, number> = {
  EMPTY: 0,
  PLANTED: 0.08,
  GERMINATED: 0.16,
  GROWING: 0.3,
  HARVESTED: 0.12,
  REMOVED: 0,
};
const FALLBACK_COLOR = "#5e9c4f";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const toHex = (channel: number) => Math.round(clamp01(channel / 255) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function lerpColor(from: string, to: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  const amount = clamp01(t);
  return rgbToHex([r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount]);
}

const WILT_COLOR = "#a8863f";
const DEAD_COLOR = "#6b5842";
const FLOWER_COLOR = "#e8c94a";
const FRUIT_COLOR = "#c0432f";
// A yellow-green, distinct from both the healthy palette and WILT_COLOR's
// brown — chlorosis (iron/micronutrient deficiency) reads as yellowing
// leaves, not drought-browning, a real and visually distinct symptom
// (architecture doc §7: "cheap simulation, high visual payoff").
const CHLOROSIS_COLOR = "#d6cf4a";
// CellEnvironmentState.micronutrientIndexFraction defaults to 0.6 (schema);
// below that is a real deficiency worth showing, at/above it reads healthy.
const CHLOROSIS_HEALTHY_THRESHOLD = 0.6;
// Dark speckled brown — distinct from WILT_COLOR (drought-browning),
// CHLOROSIS_COLOR (yellow-green deficiency), and DEAD_COLOR, so a diseased
// plant reads as its own symptom rather than blending into an existing one.
const DISEASE_COLOR = "#4a3f2e";
// Caps how far severity alone can push the tint, mirroring
// foliageColor()'s existing 0.5 cap on the chlorosis blend — full black
// would read as dead, not diseased.
const DISEASE_TINT_STRENGTH = 0.4;

// Shared by foliageColor's wilt-tint lerp and the base droop rotation below
// — extracted so the two signals can't diverge (a plant that looks wilted
// in color but stands perfectly upright would read as a bug, not a
// deliberate choice).
function wiltAmount(growth: PlantGrowthProps): number {
  return clamp01((1 - growth.waterContentIndex) * 0.6 + growth.cumulativeStress * 0.4);
}

// Health/stress makes the foliage color drift toward wilted/dead/chlorotic
// tones rather than only ever showing "healthy species color" — this is the
// visual payoff of the biology engine's stress dials (architecture doc §8):
// a struggling plant should look struggling, not just grow slower.
function foliageColor(growth: PlantGrowthProps): string {
  if (growth.phenologyStage === "DEAD") {
    return DEAD_COLOR;
  }
  const wilted = lerpColor(growth.primaryColor, WILT_COLOR, wiltAmount(growth));
  const chlorosisAmount = clamp01(
    (CHLOROSIS_HEALTHY_THRESHOLD - growth.micronutrientIndexFraction) / CHLOROSIS_HEALTHY_THRESHOLD,
  );
  const chlorotic = lerpColor(wilted, CHLOROSIS_COLOR, chlorosisAmount * 0.5);
  const diseaseSeverity = growth.infection?.severity ?? 0;
  return lerpColor(chlorotic, DISEASE_COLOR, diseaseSeverity * DISEASE_TINT_STRENGTH);
}

// A flat ring at the plant's base, colored by whichever stress dial was
// dominant — the wilt/chlorosis color drift above shows THAT something's
// wrong, this names WHICH problem, the same "your main problem right now is
// X" legibility principle stress-service.ts's dominantStressLabel already
// applies to the text readout (CellPicker.tsx), now in the 3D view too.
function StressRing({ growth, crownSize }: { growth: PlantGrowthProps; crownSize: number }) {
  const band = healthBand(growth);
  if (band === "healthy") {
    return null;
  }
  const color = growth.dominantStressDial ? (STRESS_DIAL_HEX[growth.dominantStressDial] ?? HEALTH_BAND_HEX[band]) : HEALTH_BAND_HEX[band];
  return (
    <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
      <ringGeometry args={[crownSize * 0.9, crownSize * 1.3, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.75} side={DoubleSide} />
    </mesh>
  );
}

function UprightBush({ growth, height, crownSize, color }: { growth: PlantGrowthProps; height: number; crownSize: number; color: string }) {
  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.012, 0.018, height, 5]} />
        <meshLambertMaterial color="#4a6b3a" />
      </mesh>
      <mesh position={[0, height, 0]}>
        <icosahedronGeometry args={[crownSize, 0]} />
        <meshLambertMaterial color={color} flatShading />
      </mesh>
      {growth.flowerFraction > 0.05 && (
        <mesh position={[crownSize * 0.6, height + crownSize * 0.5, 0]}>
          <sphereGeometry args={[crownSize * 0.25, 6, 6]} />
          <meshLambertMaterial color={FLOWER_COLOR} />
        </mesh>
      )}
      {growth.fruitFraction > 0.05 && (
        <mesh position={[-crownSize * 0.5, height + crownSize * 0.3, crownSize * 0.4]}>
          <sphereGeometry args={[crownSize * (0.2 + growth.fruitFraction * 0.3), 6, 6]} />
          <meshLambertMaterial color={FRUIT_COLOR} />
        </mesh>
      )}
    </group>
  );
}

function Vining({ growth, height, crownSize, color, seed }: { growth: PlantGrowthProps; height: number; crownSize: number; color: string; seed: number }) {
  const lean = ((seed % 7) - 3) * 0.03;
  const segments = 3;
  return (
    <group rotation={[lean, 0, lean * 0.6]}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.008, 0.014, height, 5]} />
        <meshLambertMaterial color="#4a6b3a" />
      </mesh>
      {Array.from({ length: segments }, (_, i) => {
        const t = (i + 1) / segments;
        return (
          <mesh key={i} position={[Math.sin(i + seed) * crownSize * 0.6, height * t, Math.cos(i + seed) * crownSize * 0.6]}>
            <icosahedronGeometry args={[crownSize * 0.6, 0]} />
            <meshLambertMaterial color={color} flatShading />
          </mesh>
        );
      })}
      {growth.fruitFraction > 0.05 &&
        Array.from({ length: Math.min(3, Math.ceil(growth.fruitFraction * 4)) }, (_, i) => (
          <mesh key={i} position={[Math.cos(i * 2 + seed) * crownSize * 0.7, height * (0.4 + i * 0.15), Math.sin(i * 2 + seed) * crownSize * 0.7]}>
            <sphereGeometry args={[crownSize * (0.18 + growth.fruitFraction * 0.2), 6, 6]} />
            <meshLambertMaterial color={FRUIT_COLOR} />
          </mesh>
        ))}
    </group>
  );
}

function RosetteLeafy({ height, crownSize, color, seed }: { height: number; crownSize: number; color: string; seed: number }) {
  const leafCount = 5;
  return (
    <group>
      {Array.from({ length: leafCount }, (_, i) => {
        const angle = (i / leafCount) * Math.PI * 2 + seed;
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * crownSize * 0.7, height * 0.5, Math.sin(angle) * crownSize * 0.7]}
            rotation={[0.3, angle, 0]}
            scale={[1, 0.5, 1]}
          >
            <icosahedronGeometry args={[crownSize * 0.55, 0]} />
            <meshLambertMaterial color={color} flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

// A small leafy top-knot over a mostly-hidden below-ground root — real root
// crops (carrot, radish) show almost nothing above soil, which is the
// visual point of this archetype existing separately from RosetteLeafy
// (a lettuce's whole plant IS its visible leaves; a carrot's isn't).
function RootCrop({ height, crownSize, color, growth, seed }: { height: number; crownSize: number; color: string; growth: PlantGrowthProps; seed: number }) {
  const leafCount = 3;
  return (
    <group>
      {Array.from({ length: leafCount }, (_, i) => {
        const angle = (i / leafCount) * Math.PI * 2 + seed;
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * crownSize * 0.3, height * 0.6, Math.sin(angle) * crownSize * 0.3]}
            rotation={[0.5, angle, 0]}
            scale={[0.6, 1, 0.6]}
          >
            <icosahedronGeometry args={[crownSize * 0.4, 0]} />
            <meshLambertMaterial color={color} flatShading />
          </mesh>
        );
      })}
      {growth.fruitFraction > 0.1 && (
        <mesh position={[0, height * 0.1, 0]}>
          <coneGeometry args={[crownSize * 0.3, height * 0.4, 6]} />
          <meshLambertMaterial color={FRUIT_COLOR} />
        </mesh>
      )}
    </group>
  );
}

// `seed` (derived from the cell's position) gives each plant a slightly
// different tilt/size so a full bed doesn't read as identical clones.
export function Plant({ status, growth, x, z, seed }: PlantProps) {
  if (status === "EMPTY" || status === "REMOVED") {
    return null;
  }

  if (!growth) {
    // No biology snapshot yet (e.g. the growth engine hasn't caught this
    // planting up for the first time) — a minimal stand-in rather than
    // rendering nothing, so a just-assigned plant is still visible.
    const height = FALLBACK_HEIGHT[status];
    if (height === 0) return null;
    const crown = 0.07 + (seed % 5) * 0.008;
    return (
      <group position={[x, 0.08, z]} rotation={[0, seed, 0]}>
        <mesh position={[0, height / 2, 0]}>
          <cylinderGeometry args={[0.012, 0.018, height, 5]} />
          <meshLambertMaterial color="#4a6b3a" />
        </mesh>
        <mesh position={[0, height, 0]}>
          <icosahedronGeometry args={[crown, 0]} />
          <meshLambertMaterial color={FALLBACK_COLOR} flatShading />
        </mesh>
      </group>
    );
  }

  const biomassFraction = clamp01(growth.leafFraction + growth.stemFraction + growth.rootFraction * 0.3);
  const height = HABIT_MAX_HEIGHT[growth.growthHabit] * biomassFraction;
  if (height <= 0.005) {
    return null;
  }
  const crownSize = 0.05 + biomassFraction * (0.05 + (seed % 5) * 0.006);
  const color = foliageColor(growth);
  // Droop is nested inside the seed-based Y rotation (not merged into the
  // same rotation prop) so per-plant orientation variance and wilt-drooping
  // stay independent axes of variation. The stress ring sits outside the
  // droop group deliberately — a ground-level indicator shouldn't tilt with
  // the plant it's marking.
  const droop = wiltAmount(growth) * 0.25;

  return (
    <group position={[x, 0.08, z]} rotation={[0, seed, 0]}>
      <StressRing growth={growth} crownSize={crownSize} />
      <group rotation={[droop, 0, droop * 0.4]}>
        {growth.growthHabit === "UPRIGHT_BUSH" && <UprightBush growth={growth} height={height} crownSize={crownSize} color={color} />}
        {growth.growthHabit === "VINING" && <Vining growth={growth} height={height} crownSize={crownSize} color={color} seed={seed} />}
        {growth.growthHabit === "ROSETTE_LEAFY" && <RosetteLeafy height={height} crownSize={crownSize} color={color} seed={seed} />}
        {growth.growthHabit === "ROOT_CROP" && <RootCrop growth={growth} height={height} crownSize={crownSize} color={color} seed={seed} />}
      </group>
    </group>
  );
}
