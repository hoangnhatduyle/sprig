// Groups a scene's cell-node world positions into one bounding extent per
// resolved bed side, for sizing/positioning equipment meshes
// (BedEquipment.tsx) over the correct bed — reuses cell-node-mapping.ts's
// decoded A1..H8 convention rather than re-deriving bed boundaries.

import { parseCellNodeName, type BedSide } from "./cell-node-mapping";

export interface CellPosition {
  nodeName: string;
  x: number;
  y: number;
  z: number;
}

export interface BedExtent {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;
  centerX: number;
  centerZ: number;
}

export function bedExtentsFromPlacements(placements: readonly CellPosition[]): Map<BedSide, BedExtent> {
  const bucketed = new Map<BedSide, CellPosition[]>();
  for (const placement of placements) {
    const coordinate = parseCellNodeName(placement.nodeName);
    if (!coordinate) {
      // Unclassifiable/unknown node names are ignored rather than thrown on
      // — mirrors garden-3d-adapter.ts's resolveBedSide "safe degradation,
      // not a silent mis-map" rule for anything that can't be placed.
      continue;
    }
    const list = bucketed.get(coordinate.bedSide) ?? [];
    list.push(placement);
    bucketed.set(coordinate.bedSide, list);
  }

  const extents = new Map<BedSide, BedExtent>();
  for (const [bedSide, positions] of bucketed) {
    const xs = positions.map((position) => position.x);
    const ys = positions.map((position) => position.y);
    const zs = positions.map((position) => position.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    extents.set(bedSide, {
      minX,
      maxX,
      minZ,
      maxZ,
      topY: Math.max(...ys),
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
    });
  }
  return extents;
}
