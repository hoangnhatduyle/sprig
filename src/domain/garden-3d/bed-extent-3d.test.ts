import { describe, expect, it } from "vitest";
import { bedExtentsFromPlacements, type CellPosition } from "./bed-extent-3d";

// Cell_A1..Cell_A4 = Left bed row A; Cell_A5..Cell_A8 = Right bed row A
// (cell-node-mapping.ts's decoded convention).
const PLACEMENTS: CellPosition[] = [
  { nodeName: "Cell_A1", x: 2, y: 0.9, z: -9 },
  { nodeName: "Cell_A4", x: 5, y: 0.9, z: -9 },
  { nodeName: "Cell_H1", x: 2, y: 0.95, z: -1 },
  { nodeName: "Cell_A5", x: 10, y: 0.9, z: -9 },
  { nodeName: "Cell_A8", x: 13, y: 0.9, z: -9 },
];

describe("bedExtentsFromPlacements", () => {
  it("produces one extent per resolved bed side with correct min/max bounds", () => {
    const extents = bedExtentsFromPlacements(PLACEMENTS);
    expect(extents.size).toBe(2);

    const left = extents.get("LEFT")!;
    expect(left.minX).toBe(2);
    expect(left.maxX).toBe(5);
    expect(left.minZ).toBe(-9);
    expect(left.maxZ).toBe(-1);
    expect(left.topY).toBeCloseTo(0.95);
    expect(left.centerX).toBeCloseTo(3.5);

    const right = extents.get("RIGHT")!;
    expect(right.minX).toBe(10);
    expect(right.maxX).toBe(13);
  });

  it("ignores node names that don't match the Cell_<A-H><1-8> convention", () => {
    const extents = bedExtentsFromPlacements([
      { nodeName: "BedLeft_Soil", x: 0, y: 0, z: 0 },
      { nodeName: "Fence_Post_3", x: 1, y: 1, z: 1 },
    ]);
    expect(extents.size).toBe(0);
  });

  it("returns an empty map for no placements", () => {
    expect(bedExtentsFromPlacements([]).size).toBe(0);
  });
});
