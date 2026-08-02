import { describe, expect, it } from "vitest";
import { buildCellRenderStates, buildEquipmentRenderStates, resolveBedSide, resolveCellTarget } from "./garden-3d-adapter";
import type { SnapshotBed } from "@/components/garden/types";

function makeBed(overrides: Partial<SnapshotBed> & Pick<SnapshotBed, "id" | "name">): SnapshotBed {
  return {
    gridCols: 4,
    gridRows: 8,
    cells: [],
    equipment: [],
    pests: [],
    predators: [],
    soilProfile: null,
    ...overrides,
  };
}

const leftBed: SnapshotBed = makeBed({
  id: "bed-left",
  name: "Left Bed",
  cells: [
    { column: 1, row: 1, status: "EMPTY", plantIds: [], environment: null, plantings: [] },
    { column: 4, row: 8, status: "GROWING", plantIds: ["plant-1"], environment: null, plantings: [] },
  ],
});

const rightBed: SnapshotBed = makeBed({
  id: "bed-right",
  name: "Right Bed",
  cells: [{ column: 1, row: 1, status: "PLANTED", plantIds: ["plant-2"], environment: null, plantings: [] }],
});

describe("resolveBedSide", () => {
  it("matches case-insensitively", () => {
    expect(resolveBedSide("Left Bed")).toBe("LEFT");
    expect(resolveBedSide("right bed")).toBe("RIGHT");
  });

  it("returns null when neither or both sides match", () => {
    expect(resolveBedSide("Herb Bed")).toBeNull();
    expect(resolveBedSide("Left-Right Bed")).toBeNull();
  });
});

describe("buildCellRenderStates", () => {
  it("keys states by the GLB node name derived from bed side + column + row", () => {
    const states = buildCellRenderStates([leftBed, rightBed], null);
    expect(states.get("Cell_A1")).toMatchObject({ bedId: "bed-left", status: "EMPTY", isSelected: false });
    expect(states.get("Cell_H4")).toMatchObject({ bedId: "bed-left", status: "GROWING", plantIds: ["plant-1"] });
    expect(states.get("Cell_A5")).toMatchObject({ bedId: "bed-right", status: "PLANTED" });
  });

  it("marks the selected cell isSelected and leaves every other cell false", () => {
    const states = buildCellRenderStates([leftBed, rightBed], {
      bedId: "bed-left",
      bedName: "Left Bed",
      column: 1,
      row: 1,
      status: "EMPTY",
      plantIds: [],
    });
    expect(states.get("Cell_A1")?.isSelected).toBe(true);
    expect(states.get("Cell_H4")?.isSelected).toBe(false);
    expect(states.get("Cell_A5")?.isSelected).toBe(false);
  });

  it("skips beds whose name can't be classified as Left or Right", () => {
    const herbBed = makeBed({ id: "bed-herb", name: "Herb Bed", cells: [{ column: 1, row: 1, status: "EMPTY", plantIds: [], environment: null, plantings: [] }] });
    const states = buildCellRenderStates([herbBed], null);
    expect(states.size).toBe(0);
  });
});

describe("resolveCellTarget", () => {
  it("resolves a clicked node name back to the matching SelectedCell", () => {
    expect(resolveCellTarget("Cell_A1", [leftBed, rightBed])).toEqual({
      bedId: "bed-left",
      bedName: "Left Bed",
      column: 1,
      row: 1,
      status: "EMPTY",
      plantIds: [],
      plantings: [],
      environment: null,
    });
    expect(resolveCellTarget("Cell_A5", [leftBed, rightBed])).toEqual({
      bedId: "bed-right",
      bedName: "Right Bed",
      column: 1,
      row: 1,
      status: "PLANTED",
      plantIds: ["plant-2"],
      plantings: [],
      environment: null,
    });
  });

  it("returns null for a non-cell node name", () => {
    expect(resolveCellTarget("BedLeft_Soil", [leftBed, rightBed])).toBeNull();
  });

  it("returns null when the resolved bed side has no matching bed", () => {
    expect(resolveCellTarget("Cell_A5", [leftBed])).toBeNull();
  });

  it("returns null when the cell's column/row isn't present in the bed's cells", () => {
    expect(resolveCellTarget("Cell_B1", [leftBed, rightBed])).toBeNull();
  });
});

describe("buildEquipmentRenderStates", () => {
  it("maps a bed's active equipment to its resolved BedSide", () => {
    const equippedLeft = makeBed({
      id: "bed-left",
      name: "Left Bed",
      equipment: [{ id: "override-1", kind: "SHADE_CLOTH", intensity: 0.4, installedAt: new Date() }],
    });
    const states = buildEquipmentRenderStates([equippedLeft, rightBed]);
    expect(states.get("LEFT")).toEqual([{ id: "override-1", kind: "SHADE_CLOTH", intensity: 0.4 }]);
    expect(states.has("RIGHT")).toBe(false);
  });

  it("contributes nothing for a bed whose name isn't Left/Right, even with equipment installed", () => {
    const herbBed = makeBed({
      id: "bed-herb",
      name: "Herb Bed",
      equipment: [{ id: "override-2", kind: "GROW_LIGHT", intensity: 0.5, installedAt: new Date() }],
    });
    const states = buildEquipmentRenderStates([herbBed]);
    expect(states.size).toBe(0);
  });

  it("preserves multiple stacked equipment kinds on the same bed", () => {
    const stacked = makeBed({
      id: "bed-left",
      name: "Left Bed",
      equipment: [
        { id: "override-3", kind: "SHADE_CLOTH", intensity: 0.3, installedAt: new Date() },
        { id: "override-4", kind: "RAIN_COVER", intensity: 0.6, installedAt: new Date() },
      ],
    });
    const states = buildEquipmentRenderStates([stacked]);
    expect(states.get("LEFT")).toHaveLength(2);
  });

  it("omits beds with no active equipment from the map entirely", () => {
    const states = buildEquipmentRenderStates([leftBed, rightBed]);
    expect(states.size).toBe(0);
  });
});
