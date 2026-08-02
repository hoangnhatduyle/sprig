// "Start New Season" — clears the garden's active/seasonal state back to an
// empty, plantable baseline while respecting this codebase's append-only
// journal conventions (NC-SPRIG-NO-OVERWRITE-JOURNAL et al.): nothing here is
// deleted. Active CellPlanting/DiseaseInfection rows are closed out via the
// same removedAt/resolvedAt soft-removal fields the rest of the domain layer
// already uses, so JournalPanel/SeasonRecapPanel can still recap them after
// the reset. Bed layout, soil/species config, plant catalog, and installed
// equipment (IrrigationSystem/RainBarrel/SolarLight/BedConditionOverride)
// are left in place — only decaying live-state fields on the equipment
// reset to their defaults. See prisma/schema.prisma's SeasonBoundary model.
//
// GridCell has no REMOVED -> EMPTY transition in planting-lifecycle.ts (see
// that file's transition table), so this writes GridCell.status directly
// rather than going through advanceLifecycle/removeCell — a deliberate new
// write path, journaled explicitly below to satisfy
// NC-SPRIG-NO-SILENT-PLANT-CHANGE.

import type { PrismaClient } from "@prisma/client";
import { resetSimClockToNow } from "@/domain/growth/sim-clock-service";

export interface SeasonResetSummary {
  cellsCleared: number;
  plantingsClosed: number;
  infectionsResolved: number;
  seasonStartedAt: Date;
}

export interface StartNewSeasonInput {
  note?: string;
}

export async function startNewSeason(
  prisma: PrismaClient,
  input?: StartNewSeasonInput,
): Promise<SeasonResetSummary> {
  const now = new Date();

  const { cellsCleared, plantingsClosed, infectionsResolved } = await prisma.$transaction(async (tx) => {
    const activePlantings = await tx.cellPlanting.findMany({
      where: { removedAt: null },
      select: { cellId: true, plantId: true },
    });

    if (activePlantings.length > 0) {
      await tx.cellPlanting.updateMany({
        where: { removedAt: null },
        data: { removedAt: now },
      });
      await tx.gridCellEvent.createMany({
        data: activePlantings.map((planting) => ({
          cellId: planting.cellId,
          plantId: planting.plantId,
          eventType: "REMOVED" as const,
          occurredAt: now,
          note: "Season reset",
        })),
      });
    }

    const clearedCells = await tx.gridCell.updateMany({
      where: { status: { not: "EMPTY" } },
      data: { status: "EMPTY", plantedAt: null, waterState: "DRY" },
    });

    const resolvedInfections = await tx.diseaseInfection.updateMany({
      where: { resolvedAt: null },
      data: { severity: 0, resolvedAt: now, updatedThroughDate: now },
    });

    await tx.pestPopulation.updateMany({ data: { population: 0, updatedThroughDate: now } });
    await tx.predatorPopulation.updateMany({ data: { population: 0, updatedThroughDate: now } });

    await tx.cellEnvironmentState.updateMany({
      data: {
        soilMoistureFraction: 0.5,
        soilTempC: 15,
        nitrogenPoolFraction: 0.6,
        phosphorusPoolFraction: 0.6,
        potassiumPoolFraction: 0.6,
        calciumPoolFraction: 0.6,
        micronutrientIndexFraction: 0.6,
        residueOrganicMatterPool: 0,
        mulchDepthMm: 0,
        daysNearSaturation: 0,
        weedPressureFraction: 0,
        updatedThroughDate: now,
      },
    });

    await tx.rainBarrel.updateMany({ data: { currentGallons: 0, status: "EMPTY" } });
    await tx.solarLight.updateMany({ data: { chargeLevel: 0, status: "CHARGING" } });
    await tx.irrigationSystem.updateMany({ data: { status: "IDLE" } });

    await tx.seasonBoundary.create({ data: { startedAt: now, note: input?.note } });

    return {
      cellsCleared: clearedCells.count,
      plantingsClosed: activePlantings.length,
      infectionsResolved: resolvedInfections.count,
    };
  });

  // Separate write, deliberately outside the transaction above — this
  // codebase has no precedent for nesting prisma.$transaction calls, and
  // resetSimClockToNow's own epoch write has no data dependency on the
  // garden-state reset it's paired with here.
  await resetSimClockToNow(prisma, now);

  return { cellsCleared, plantingsClosed, infectionsResolved, seasonStartedAt: now };
}
