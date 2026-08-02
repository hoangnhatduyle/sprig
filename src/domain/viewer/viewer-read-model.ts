import type { PrismaClient } from "@prisma/client";
import { getWaterSnapshot } from "../irrigation/irrigation-service";
import { computeCellLightExposure } from "../lighting/cell-light-exposure";
import { getGardenLocation } from "../lighting/garden-location";
import type { CellStatus } from "../grid/planting-lifecycle";
import { bucketLightLevel, type ViewerCellView } from "./viewer-cell-view";

// The REAL baseline the 3D viewer renders: geometry + planting status from
// the grid tables, wet/dry from the irrigation read model, light from the
// captured sun/shadow curves at `at`. Composed from the existing per-domain
// read functions rather than a bespoke query, so REAL mode can never drift
// from what the rest of the app reports.
//
// `at` is a plain instant, which is what makes the same function serve both
// modes: REAL passes "now", SIMULATION passes the hypothetical time-of-day
// the user is scrubbing to. Neither writes anything.
export async function getViewerCells(prisma: PrismaClient, at: Date): Promise<ViewerCellView[]> {
  const [beds, waterSnapshot, location] = await Promise.all([
    prisma.bed.findMany({
      orderBy: { name: "asc" },
      include: {
        cells: {
          orderBy: [{ row: "asc" }, { column: "asc" }],
          include: { cellPlantings: { where: { removedAt: null }, select: { id: true } } },
        },
      },
    }),
    getWaterSnapshot(prisma),
    getGardenLocation(prisma),
  ]);

  const wetByCellId = new Map(waterSnapshot.map((cell) => [cell.cellId, cell.wet]));

  return beds.flatMap((bed, bedIndex) =>
    bed.cells.map((cell) => ({
      cellId: cell.id,
      wet: wetByCellId.get(cell.id) ?? false,
      lightLevel: bucketLightLevel(computeCellLightExposure(cell.baselineLight, location, at)),
      baselineLight: cell.baselineLight,
      bedIndex,
      bedName: bed.name,
      column: cell.column,
      row: cell.row,
      status: cell.status as CellStatus,
      plantCount: cell.cellPlantings.length,
    })),
  );
}
