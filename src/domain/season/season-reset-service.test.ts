import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignPlant, seedBed } from "@/domain/grid/grid-cell-service";
import { createTestPrismaClient, resetGridTables } from "@/domain/grid/test-db";
import { resetGrowthTables } from "@/domain/growth/test-db";
import { resetConditionsTables } from "@/domain/conditions/test-db";
import { resetIrrigationTables } from "@/domain/irrigation/test-db";
import { resetLightingTables } from "@/domain/lighting/test-db";
import { resetSeasonTables } from "./test-db";
import { createInventoryPlant } from "@/domain/plant-catalog/inventory-service";
import { applyMulchToCell } from "@/domain/soil/care-actions-service";
import { installConditionOverride } from "@/domain/conditions/bed-condition-override-service";
import { createJournalNote } from "@/domain/journal/journal-note-service";
import { startNewSeason } from "./season-reset-service";

let prisma: PrismaClient;

async function resetAll(client: PrismaClient): Promise<void> {
  await resetSeasonTables(client);
  await resetConditionsTables(client);
  await resetIrrigationTables(client);
  await resetLightingTables(client);
  await resetGrowthTables(client);
  await resetGridTables(client);
}

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetAll(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

afterAll(async () => {
  const cleanup = createTestPrismaClient();
  await resetAll(cleanup);
  await cleanup.$disconnect();
});

describe("startNewSeason", () => {
  it("closes out active plantings/infections, zeroes populations, resets cells and equipment live-state, and stamps a SeasonBoundary", async () => {
    const bed = await seedBed(prisma, { name: "Reset Bed", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, { commonName: "Tomato", seedQuantity: 5, seedUnit: "seed" });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 1 } },
    });
    await prisma.gridCell.update({ where: { id: cell.id }, data: { waterState: "WET" } });
    await prisma.cellEnvironmentState.create({
      data: { cellId: cell.id, soilMoistureFraction: 0.9, nitrogenPoolFraction: 0.2, mulchDepthMm: 40 },
    });
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    await prisma.diseaseInfection.create({
      data: { cellPlantingId: planting.id, diseaseKey: "powdery-mildew", severity: 0.6 },
    });
    await prisma.pestPopulation.create({ data: { bedId: bed.id, pestKey: "aphid", population: 25 } });
    await prisma.predatorPopulation.create({ data: { bedId: bed.id, predatorKey: "ladybug", population: 4 } });

    const irrigation = await prisma.irrigationSystem.create({
      data: { status: "RUNNING", beds: { connect: { id: bed.id } } },
    });
    const rainBarrel = await prisma.rainBarrel.create({
      data: { yardSlot: 1, currentGallons: 30, status: "PARTIAL" },
    });
    const solarLight = await prisma.solarLight.create({ data: { bedId: bed.id, chargeLevel: 0.7, status: "READY" } });
    const override = await installConditionOverride(prisma, { bedId: bed.id, kind: "SHADE_CLOTH", intensity: 0.5 });

    await applyMulchToCell(prisma, { bedId: bed.id, column: 1, row: 1, depthMm: 20 });
    await createJournalNote(prisma, { bedId: bed.id, column: null, row: null, body: "Test note", photoFilename: null, photoMimeType: null });

    const preResetJournalEventCount = await prisma.gridCellEvent.count();
    const preResetCareActionCount = await prisma.careActionEvent.count();
    const preResetNoteCount = await prisma.journalNote.count();

    const summary = await startNewSeason(prisma, { note: "manual test reset" });

    expect(summary.plantingsClosed).toBe(1);
    expect(summary.cellsCleared).toBe(1);
    expect(summary.infectionsResolved).toBe(1);

    // CellPlanting closed out, not deleted.
    const closedPlanting = await prisma.cellPlanting.findUniqueOrThrow({ where: { id: planting.id } });
    expect(closedPlanting.removedAt).not.toBeNull();

    // GridCell back to a fresh EMPTY state.
    const resetCell = await prisma.gridCell.findUniqueOrThrow({ where: { id: cell.id } });
    expect(resetCell.status).toBe("EMPTY");
    expect(resetCell.plantedAt).toBeNull();
    expect(resetCell.waterState).toBe("DRY");

    // A new GridCellEvent records the closure — history isn't silently changed.
    const postResetJournalEventCount = await prisma.gridCellEvent.count();
    expect(postResetJournalEventCount).toBe(preResetJournalEventCount + 1);

    // DiseaseInfection resolved in place, not deleted.
    const resolvedInfection = await prisma.diseaseInfection.findFirstOrThrow({ where: { cellPlantingId: planting.id } });
    expect(resolvedInfection.resolvedAt).not.toBeNull();
    expect(resolvedInfection.severity).toBe(0);

    // Pest/predator populations zeroed, rows kept.
    const pest = await prisma.pestPopulation.findUniqueOrThrow({ where: { bedId_pestKey: { bedId: bed.id, pestKey: "aphid" } } });
    expect(pest.population).toBe(0);
    const predator = await prisma.predatorPopulation.findUniqueOrThrow({
      where: { bedId_predatorKey: { bedId: bed.id, predatorKey: "ladybug" } },
    });
    expect(predator.population).toBe(0);

    // Soil/environment state reset to schema defaults.
    const env = await prisma.cellEnvironmentState.findUniqueOrThrow({ where: { cellId: cell.id } });
    expect(env.soilMoistureFraction).toBe(0.5);
    expect(env.nitrogenPoolFraction).toBe(0.6);
    expect(env.mulchDepthMm).toBe(0);

    // Equipment fixtures persist; only their live state resets.
    const irrigationAfter = await prisma.irrigationSystem.findUniqueOrThrow({ where: { id: irrigation.id } });
    expect(irrigationAfter.status).toBe("IDLE");
    const rainBarrelAfter = await prisma.rainBarrel.findUniqueOrThrow({ where: { id: rainBarrel.id } });
    expect(rainBarrelAfter.currentGallons).toBe(0);
    expect(rainBarrelAfter.status).toBe("EMPTY");
    const solarLightAfter = await prisma.solarLight.findUniqueOrThrow({ where: { id: solarLight.id } });
    expect(solarLightAfter.chargeLevel).toBe(0);
    expect(solarLightAfter.status).toBe("CHARGING");

    // BedConditionOverride (installed shade cloth) is untouched.
    const overrideAfter = await prisma.bedConditionOverride.findUniqueOrThrow({ where: { id: override.id } });
    expect(overrideAfter.removedAt).toBeNull();
    expect(overrideAfter.intensity).toBe(0.5);

    // Journal/history rows are never touched by a reset.
    expect(await prisma.careActionEvent.count()).toBe(preResetCareActionCount);
    expect(await prisma.journalNote.count()).toBe(preResetNoteCount);

    // A new SeasonBoundary is stamped.
    const boundary = await prisma.seasonBoundary.findFirstOrThrow({ where: { note: "manual test reset" } });
    expect(boundary.startedAt.getTime()).toBeCloseTo(summary.seasonStartedAt.getTime(), -2);
  });

  it("is a no-op that doesn't error when run against an already-empty garden", async () => {
    const bed = await seedBed(prisma, { name: "Empty Bed", compassPosition: "SOUTH" });

    const summary = await startNewSeason(prisma);

    expect(summary.plantingsClosed).toBe(0);
    expect(summary.cellsCleared).toBe(0);
    expect(summary.infectionsResolved).toBe(0);

    const cells = await prisma.gridCell.findMany({ where: { bedId: bed.id } });
    expect(cells.every((c) => c.status === "EMPTY")).toBe(true);

    const boundaries = await prisma.seasonBoundary.findMany();
    expect(boundaries).toHaveLength(1);
  });
});
