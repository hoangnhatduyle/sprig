// Maps grid coordinates (bed side, column, row) to/from the node names baked
// into docs/Sprig3D.glb's Blender export. The model already ships 64 nodes
// named Cell_A1..Cell_H8 on an invisible "CellHitTarget" material — decoding
// their world positions showed letters are rows (A=1..H=8) and numbers split
// at the bed boundary: 1-4 is the Left bed's columns 1-4, 5-8 is the Right
// bed's columns 1-4 (subtract 4). This is the single source of truth for that
// convention so the 3D scene and its adapter can't encode it two different
// ways.

const ROWS = 8;
const COLUMNS_PER_BED = 4;
const ROW_LETTER_OFFSET = "A".charCodeAt(0);

export type BedSide = "LEFT" | "RIGHT";

export interface GridCoordinate {
  bedSide: BedSide;
  column: number;
  row: number;
}

function isInRange(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

export function cellNodeName({ bedSide, column, row }: GridCoordinate): string {
  if (!isInRange(column, COLUMNS_PER_BED) || !isInRange(row, ROWS)) {
    throw new RangeError(
      `cellNodeName: column must be 1-${COLUMNS_PER_BED} and row 1-${ROWS}, got column=${column} row=${row}`,
    );
  }
  const letter = String.fromCharCode(ROW_LETTER_OFFSET + row - 1);
  const number = bedSide === "LEFT" ? column : column + COLUMNS_PER_BED;
  return `Cell_${letter}${number}`;
}

const NODE_NAME_PATTERN = /^Cell_([A-H])([1-8])$/;

export function parseCellNodeName(name: string): GridCoordinate | null {
  const match = NODE_NAME_PATTERN.exec(name);
  if (!match) {
    return null;
  }
  const row = match[1].charCodeAt(0) - ROW_LETTER_OFFSET + 1;
  const number = Number(match[2]);
  const bedSide: BedSide = number <= COLUMNS_PER_BED ? "LEFT" : "RIGHT";
  const column = bedSide === "LEFT" ? number : number - COLUMNS_PER_BED;
  return { bedSide, column, row };
}
