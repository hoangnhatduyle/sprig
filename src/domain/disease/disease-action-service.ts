// Fungicide (architecture doc §12): "knocks down targeted disease severity"
// — a real, meaningful intervention, not an instant cure, matching §15's
// "recoverable, not a death sentence" balancing principle (the SAME
// treatment care-actions-service.ts's weeding action already gives weed
// pressure). Cell-scoped, not bed-scoped, since disease infection is
// per-planting state (DiseaseInfection), unlike bed-scoped pest
// populations (pest-action-service.ts).

import type { PrismaClient } from "@prisma/client";

// A single application never fully cures — some fungal load remains, the
// same "one pass doesn't guarantee zero regrowth" honesty
// care-actions-service.ts's WEEDING_REDUCTION_FRACTION already models.
const FUNGICIDE_REDUCTION_FRACTION = 0.7;
const RESOLVE_BELOW_SEVERITY = 0.03;

export interface CellLookup {
  bedId: string;
  column: number;
  row: number;
}

// Applies to every active infection among the cell's currently-active
// plantings (companion planting means more than one CellPlanting can occupy
// a cell) — a gardener spraying a cell treats whatever's growing there, not
// one specific planting they have to pick out.
export async function applyFungicideToCell(prisma: PrismaClient, input: CellLookup): Promise<number> {
  const cell = await prisma.gridCell.findUniqueOrThrow({
    where: { bedId_column_row: { bedId: input.bedId, column: input.column, row: input.row } },
  });
  const activePlantings = await prisma.cellPlanting.findMany({ where: { cellId: cell.id, removedAt: null } });
  const activeInfections = await prisma.diseaseInfection.findMany({
    where: { cellPlantingId: { in: activePlantings.map((planting) => planting.id) }, resolvedAt: null },
  });

  const now = new Date();
  for (const infection of activeInfections) {
    const severity = infection.severity * (1 - FUNGICIDE_REDUCTION_FRACTION);
    if (severity <= RESOLVE_BELOW_SEVERITY) {
      await prisma.diseaseInfection.update({
        where: { id: infection.id },
        data: { severity: 0, resolvedAt: now, updatedThroughDate: now },
      });
    } else {
      await prisma.diseaseInfection.update({
        where: { id: infection.id },
        data: { severity, updatedThroughDate: now },
      });
    }
  }

  // One durable CareActionEvent per application (not per infection treated)
  // — a gardener sprayed the cell once, regardless of how many infections
  // were active on it. Purely for the Journal read model
  // (src/domain/journal/journal-service.ts); DiseaseInfection above stays
  // the current-state model.
  await prisma.careActionEvent.create({
    data: {
      bedId: input.bedId,
      cellId: cell.id,
      actionType: "FUNGICIDE",
      detail: JSON.stringify({ infectionsTreated: activeInfections.length }),
    },
  });

  return activeInfections.length;
}
