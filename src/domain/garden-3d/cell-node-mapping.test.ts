import { describe, expect, it } from "vitest";
import { cellNodeName, parseCellNodeName } from "./cell-node-mapping";

describe("cellNodeName", () => {
  it("encodes row 1 column 1 of the Left bed as Cell_A1", () => {
    expect(cellNodeName({ bedSide: "LEFT", column: 1, row: 1 })).toBe("Cell_A1");
  });

  it("encodes row 8 column 4 of the Left bed as Cell_H4", () => {
    expect(cellNodeName({ bedSide: "LEFT", column: 4, row: 8 })).toBe("Cell_H4");
  });

  it("shifts the Right bed's columns by 4 (column 1 -> number 5)", () => {
    expect(cellNodeName({ bedSide: "RIGHT", column: 1, row: 1 })).toBe("Cell_A5");
  });

  it("encodes row 8 column 4 of the Right bed as Cell_H8", () => {
    expect(cellNodeName({ bedSide: "RIGHT", column: 4, row: 8 })).toBe("Cell_H8");
  });

  it("rejects a column outside 1-4", () => {
    expect(() => cellNodeName({ bedSide: "LEFT", column: 5, row: 1 })).toThrow(RangeError);
    expect(() => cellNodeName({ bedSide: "LEFT", column: 0, row: 1 })).toThrow(RangeError);
  });

  it("rejects a row outside 1-8", () => {
    expect(() => cellNodeName({ bedSide: "LEFT", column: 1, row: 9 })).toThrow(RangeError);
    expect(() => cellNodeName({ bedSide: "LEFT", column: 1, row: 0 })).toThrow(RangeError);
  });
});

describe("parseCellNodeName", () => {
  it("round-trips every Left-bed coordinate through cellNodeName", () => {
    for (let row = 1; row <= 8; row += 1) {
      for (let column = 1; column <= 4; column += 1) {
        const coordinate = { bedSide: "LEFT" as const, column, row };
        expect(parseCellNodeName(cellNodeName(coordinate))).toEqual(coordinate);
      }
    }
  });

  it("round-trips every Right-bed coordinate through cellNodeName", () => {
    for (let row = 1; row <= 8; row += 1) {
      for (let column = 1; column <= 4; column += 1) {
        const coordinate = { bedSide: "RIGHT" as const, column, row };
        expect(parseCellNodeName(cellNodeName(coordinate))).toEqual(coordinate);
      }
    }
  });

  it("places the boundary between number 4 (Left) and number 5 (Right)", () => {
    expect(parseCellNodeName("Cell_A4")).toEqual({ bedSide: "LEFT", column: 4, row: 1 });
    expect(parseCellNodeName("Cell_A5")).toEqual({ bedSide: "RIGHT", column: 1, row: 1 });
  });

  it("returns null for names outside the Cell_<A-H><1-8> pattern", () => {
    expect(parseCellNodeName("BedLeft_Soil")).toBeNull();
    expect(parseCellNodeName("Cell_I1")).toBeNull();
    expect(parseCellNodeName("Cell_A9")).toBeNull();
    expect(parseCellNodeName("Cell_A0")).toBeNull();
    expect(parseCellNodeName("Cell_a1")).toBeNull();
    expect(parseCellNodeName("")).toBeNull();
  });
});
