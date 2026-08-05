import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient, resetGridTables } from "./test-db";
import { resetGrowthTables } from "../growth/test-db";
import { assignPlant, getGardenSnapshot, seedBed } from "./grid-cell-service";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-GROWTH-004.yaml
// Data-plumbing test underneath AC-1/AC-2: verifies PlantingGrowthView
// exposes accumulatedGdd and the four species GDD thresholds so the UI
// (CellPicker.tsx) can compute progress-to-next-stage and the height
// estimate client-side.

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetGrowthTables(prisma);
  await resetGridTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

afterAll(async () => {
  const cleanup = createTestPrismaClient();
  await resetGrowthTables(cleanup);
  await resetGridTables(cleanup);
  await cleanup.$disconnect();
});

async function createSpecies(prisma: PrismaClient, key: string) {
  return prisma.speciesProfile.create({
    data: {
      key,
      displayName: key,
      growthHabit: "UPRIGHT_BUSH",
      baseTempC: -10,
      gddToGerminate: 10,
      gddToVegetative: 100,
      gddToFlowering: 300,
      gddToFruiting: 600,
      gddToMaturity: 900,
      heatStressThresholdC: 50,
      coldStressThresholdC: -20,
      droughtComfortFraction: 0.1,
      matureHeightCm: 150,
      canopyWidthCm: 60,
      primaryColor: "#3f8f3a",
    },
  });
}

describe("SPEC-GROWTH-004 — PlantingGrowthView GDD read-model", () => {
  it("exposes accumulatedGdd and species GDD thresholds on PlantingGrowthView (data plumbing for SPEC-GROWTH-004 AC-1/AC-2)", async () => {
    const species = await createSpecies(prisma, "test-tomato");
    const bed = await seedBed(prisma, { name: "Test Bed", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({
      data: { commonName: "Tomato", speciesProfileId: species.id },
    });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    const cellPlanting = await prisma.cellPlanting.findFirstOrThrow({
      where: { plantId: plant.id, removedAt: null },
    });
    await prisma.plantingBiologyState.create({
      data: {
        cellPlantingId: cellPlanting.id,
        accumulatedGdd: 200,
        phenologyStage: "VEGETATIVE",
      },
    });

    const snapshot = await getGardenSnapshot(prisma);
    const cell = snapshot.beds[0].cells.find((c) => c.column === 1 && c.row === 1)!;
    const growth = cell.plantings[0].growth;

    expect(growth).toMatchObject({
      accumulatedGdd: 200,
      gddToVegetative: 100,
      gddToFlowering: 300,
      gddToFruiting: 600,
      gddToMaturity: 900,
    });
  });
});
