// Bridges the 2D garden's live state (SnapshotBed[], the exact data
// GardenGrid renders) into what the GLB-based 3D scene needs, and back.
// There is deliberately no separate 3D data path: both views read the same
// `beds` state GardenView.tsx holds, so they can't drift out of sync.

import type { CellStatus } from "@/domain/grid/planting-lifecycle";
import type { ConditionOverrideKind, PlantingGrowthView } from "@/domain/grid/grid-cell-service";
import { cellNodeName, parseCellNodeName, type BedSide } from "@/domain/garden-3d/cell-node-mapping";
import { pestSwarmVisual, predatorSwarmVisual, type PestSwarmVisual } from "@/domain/garden-3d/pest-swarm-3d";
import { rainBarrelFillFraction } from "@/domain/garden-3d/rain-barrel-fill";
import type { SelectedCell, SnapshotBed, SnapshotRainBarrel } from "@/components/garden/types";

export interface CellRenderState {
  bedId: string;
  bedName: string;
  column: number;
  row: number;
  status: CellStatus;
  plantIds: string[];
  isSelected: boolean;
  growth: PlantingGrowthView | null;
}

// The GLB's Left/Right split has no representation in the Prisma schema
// (Bed.compassPosition is SOUTH/NORTH, an unrelated axis) - the only stable
// signal is the bed's name. getGardenSnapshot() queries beds with no
// `orderBy` (grid-cell-service.ts), so array position is not a safe stand-in.
// A bed whose name doesn't say "left" or "right" is left unclassified rather
// than guessed at by position - it simply won't render in 3D, which is safe
// degradation, not a silent mis-map.
export function resolveBedSide(bedName: string): BedSide | null {
  const normalized = bedName.toLowerCase();
  const isLeft = normalized.includes("left");
  const isRight = normalized.includes("right");
  if (isLeft === isRight) {
    // Neither matched, or (a bed named e.g. "Left-Right") both did - both are
    // ambiguous in the same way.
    return null;
  }
  return isLeft ? "LEFT" : "RIGHT";
}

// One lookup, keyed by the GLB's own node names, built fresh from the current
// `beds` state + selection on every render. Cheap: at most 64 cells.
export function buildCellRenderStates(
  beds: readonly SnapshotBed[],
  selectedCell: SelectedCell | null,
): Map<string, CellRenderState> {
  const states = new Map<string, CellRenderState>();
  for (const bed of beds) {
    const bedSide = resolveBedSide(bed.name);
    if (!bedSide) {
      continue;
    }
    for (const cell of bed.cells) {
      const nodeName = cellNodeName({ bedSide, column: cell.column, row: cell.row });
      states.set(nodeName, {
        bedId: bed.id,
        bedName: bed.name,
        column: cell.column,
        row: cell.row,
        status: cell.status,
        plantIds: cell.plantIds,
        isSelected:
          selectedCell?.bedId === bed.id &&
          selectedCell.column === cell.column &&
          selectedCell.row === cell.row,
        growth: cell.plantings[0]?.growth ?? null,
      });
    }
  }
  return states;
}

export interface EquipmentRenderState {
  id: string;
  kind: ConditionOverrideKind;
  intensity: number;
}

// Groups each bed's active equipment (SnapshotBed.equipment,
// grid-cell-service.ts) by the same resolved BedSide buildCellRenderStates
// already uses, so BedEquipment.tsx can look up "what's installed on the
// Left bed" without re-deriving the name->side resolution. A bed that can't
// be resolved to a side contributes no equipment, mirroring
// buildCellRenderStates' own safe-degradation rule.
export function buildEquipmentRenderStates(beds: readonly SnapshotBed[]): Map<BedSide, EquipmentRenderState[]> {
  const bySide = new Map<BedSide, EquipmentRenderState[]>();
  for (const bed of beds) {
    const bedSide = resolveBedSide(bed.name);
    if (!bedSide || bed.equipment.length === 0) {
      continue;
    }
    bySide.set(
      bedSide,
      bed.equipment.map((override) => ({ id: override.id, kind: override.kind, intensity: override.intensity })),
    );
  }
  return bySide;
}

// Groups each bed's pest population into the same resolved BedSide
// buildEquipmentRenderStates uses, so PestSwarm.tsx can look up "what's
// swarming the Left bed" the same way BedEquipment.tsx looks up equipment.
// A bed that can't be resolved to a side contributes no swarm, mirroring
// buildEquipmentRenderStates' own safe-degradation rule.
export function buildPestSwarmRenderStates(beds: readonly SnapshotBed[]): Map<BedSide, PestSwarmVisual | null> {
  const bySide = new Map<BedSide, PestSwarmVisual | null>();
  for (const bed of beds) {
    const bedSide = resolveBedSide(bed.name);
    if (!bedSide) {
      continue;
    }
    bySide.set(bedSide, pestSwarmVisual(bed.pests));
  }
  return bySide;
}

// Same grouping as buildPestSwarmRenderStates, for the bed's predator
// population instead — a separate render state (not folded into the pest
// one) so GardenScene3D.tsx can render both swarms simultaneously, at
// different heights, when a bed has both pests and released predators.
export function buildPredatorSwarmRenderStates(beds: readonly SnapshotBed[]): Map<BedSide, PestSwarmVisual | null> {
  const bySide = new Map<BedSide, PestSwarmVisual | null>();
  for (const bed of beds) {
    const bedSide = resolveBedSide(bed.name);
    if (!bedSide) {
      continue;
    }
    bySide.set(bedSide, predatorSwarmVisual(bed.predators));
  }
  return bySide;
}

export interface RainBarrelRenderState {
  id: string;
  fillFraction: number;
}

// Rain barrels are standalone yard objects, not bed-scoped equipment (see
// RainBarrelPlacement's own doc comment in GardenScene3D.tsx) — keyed by
// yardSlot (the stable RainBarrel_<n>_* GLB node mapping), not BedSide, so
// this deliberately doesn't follow buildEquipmentRenderStates' bed-grouping
// shape above.
export function buildRainBarrelRenderStates(
  rainBarrels: readonly SnapshotRainBarrel[],
): Map<number, RainBarrelRenderState> {
  const byYardSlot = new Map<number, RainBarrelRenderState>();
  for (const barrel of rainBarrels) {
    byYardSlot.set(barrel.yardSlot, {
      id: barrel.id,
      fillFraction: rainBarrelFillFraction(barrel.currentGallons, barrel.capacityGallons),
    });
  }
  return byYardSlot;
}

// The reverse direction: a clicked GLB node name -> the SelectedCell shape
// GardenView's picker reducer expects. Returns null for anything that isn't
// a recognized cell node, or whose bed can't be resolved to a side.
export function resolveCellTarget(
  nodeName: string,
  beds: readonly SnapshotBed[],
): SelectedCell | null {
  const coordinate = parseCellNodeName(nodeName);
  if (!coordinate) {
    return null;
  }
  const bed = beds.find((candidate) => resolveBedSide(candidate.name) === coordinate.bedSide);
  if (!bed) {
    return null;
  }
  const cell = bed.cells.find((candidate) => candidate.column === coordinate.column && candidate.row === coordinate.row);
  if (!cell) {
    return null;
  }
  return {
    bedId: bed.id,
    bedName: bed.name,
    column: cell.column,
    row: cell.row,
    status: cell.status,
    plantIds: cell.plantIds,
    plantings: cell.plantings,
    environment: cell.environment,
  };
}
