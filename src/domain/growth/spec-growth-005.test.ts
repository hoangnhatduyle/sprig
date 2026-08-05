import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient, resetGrowthTables } from "./test-db";
import { resetGridTables } from "../grid/test-db";
import { assignPlant, removeCell, seedBed } from "../grid/grid-cell-service";
import { catchUpGrowth } from "./catch-up-service";
import { overridePlantingStage } from "./stage-override-service";
import { InvalidTargetStageError, PlantingNotFoundError, PlantingRemovedError } from "./errors";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-GROWTH-005.yaml

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

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Small GDD thresholds and a low base temp so a real catchUpGrowth run (used
// here only to build a "polluted", weather-driven history to override away
// from) reaches every phenology stage within a handful of simulated days —
// the same determinism trick spec-growth-001/002/003.test.ts already use.
async function createFastSpecies(prisma: PrismaClient, key: string) {
  return prisma.speciesProfile.create({
    data: {
      key,
      displayName: key,
      growthHabit: "UPRIGHT_BUSH",
      baseTempC: -10,
      gddToGerminate: 1,
      gddToVegetative: 2,
      gddToFlowering: 3,
      gddToFruiting: 5,
      gddToMaturity: 100_000,
      heatStressThresholdC: 50,
      coldStressThresholdC: -20,
      droughtComfortFraction: 0.1,
      matureHeightCm: 30,
      canopyWidthCm: 30,
      primaryColor: "#3f8f3a",
    },
  });
}

describe("SPEC-GROWTH-005", () => {
  it("T-SPEC-GROWTH-005-AC-AC_1: overriding to FRUITING resets health regardless of prior degraded state", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const species = await createFastSpecies(prisma, "test-override-ac1");
    const plant = await prisma.plant.create({ data: { commonName: "Test Plant", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    await catchUpGrowth(prisma, { through: addDays(new Date(), 1) });

    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    // Deliberately degrade the real, pre-override health state so the
    // subsequent override's reset is proven to happen REGARDLESS of prior
    // values (NC-SPRIG-GROWTH5-CLEAN-SLATE-RESET), not just coincidentally
    // clean because nothing bad happened yet.
    await prisma.plantingBiologyState.update({
      where: { cellPlantingId: planting.id },
      data: { waterContentIndex: 0.1, cumulativeStress: 0.9 },
    });

    await overridePlantingStage(prisma, { cellPlantingId: planting.id, targetStage: "FRUITING" });

    const result = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: planting.id } });
    expect(result.phenologyStage).toBe("FRUITING");
    expect(result.accumulatedGdd).toBeGreaterThanOrEqual(species.gddToFruiting);
    expect(result.accumulatedGdd).toBeLessThan(species.gddToMaturity);
    expect(result.waterContentIndex).toBe(1);
    expect(result.cumulativeStress).toBe(0);
    expect(result.leafFraction).toBeGreaterThan(0.05);
  });

  it("T-SPEC-GROWTH-005-AC-AC_2: replay is a pure function of species + target stage, independent of prior real history", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const species = await createFastSpecies(prisma, "test-override-ac2");
    const plantA = await prisma.plant.create({ data: { commonName: "Plant A", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plantA.id });

    // Plant A gets a real, weather-driven history all the way into FRUITING
    // before being overridden back down to VEGETATIVE.
    await catchUpGrowth(prisma, { through: addDays(new Date(), 10) });
    const plantingA = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plantA.id } });
    const beforeOverrideA = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: plantingA.id } });
    expect(beforeOverrideA.phenologyStage).toBe("FRUITING");

    // Plant B is assigned only AFTER plant A's catch-up run, so a second
    // catchUpGrowth call wouldn't sweep it in too — it's overridden directly,
    // with no catchUpGrowth history at all; its PlantingBiologyState row
    // doesn't exist yet going in.
    const plantB = await prisma.plant.create({ data: { commonName: "Plant B", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: bed.id, column: 3, row: 1, plantId: plantB.id });
    const plantingB = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plantB.id } });
    expect(await prisma.plantingBiologyState.findUnique({ where: { cellPlantingId: plantingB.id } })).toBeNull();

    await overridePlantingStage(prisma, { cellPlantingId: plantingA.id, targetStage: "VEGETATIVE" });
    await overridePlantingStage(prisma, { cellPlantingId: plantingB.id, targetStage: "VEGETATIVE" });

    const resultA = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: plantingA.id } });
    const resultB = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: plantingB.id } });

    expect(resultA.phenologyStage).toBe(resultB.phenologyStage);
    expect(resultA.accumulatedGdd).toBe(resultB.accumulatedGdd);
    expect(resultA.leafFraction).toBe(resultB.leafFraction);
    expect(resultA.stemFraction).toBe(resultB.stemFraction);
    expect(resultA.rootFraction).toBe(resultB.rootFraction);
    expect(resultA.flowerFraction).toBe(resultB.flowerFraction);
    expect(resultA.fruitFraction).toBe(resultB.fruitFraction);
    expect(resultA.storedReserves).toBe(resultB.storedReserves);
    expect(resultA.waterContentIndex).toBe(resultB.waterContentIndex);
    expect(resultA.cumulativeStress).toBe(resultB.cumulativeStress);
  });

  it("T-SPEC-GROWTH-005-AC-AC_3: catchUpGrowth advances zero days immediately after an override", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const species = await createFastSpecies(prisma, "test-override-ac3");
    const plant = await prisma.plant.create({ data: { commonName: "Test Plant", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });

    await overridePlantingStage(prisma, { cellPlantingId: planting.id, targetStage: "FLOWERING" });
    const afterOverride = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: planting.id } });

    await catchUpGrowth(prisma, {});

    const afterCatchUp = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: planting.id } });
    expect(afterCatchUp).toEqual(afterOverride);
  });

  it("T-SPEC-GROWTH-005-AC-AC_4: SENESCENT and DEAD are rejected with no write", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const species = await createFastSpecies(prisma, "test-override-ac4");
    const plant = await prisma.plant.create({ data: { commonName: "Test Plant", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });

    await expect(
      overridePlantingStage(prisma, { cellPlantingId: planting.id, targetStage: "SENESCENT" }),
    ).rejects.toThrow(InvalidTargetStageError);
    await expect(
      overridePlantingStage(prisma, { cellPlantingId: planting.id, targetStage: "DEAD" }),
    ).rejects.toThrow(InvalidTargetStageError);

    const row = await prisma.plantingBiologyState.findUnique({ where: { cellPlantingId: planting.id } });
    expect(row).toBeNull();
  });

  it("T-SPEC-GROWTH-005-AC-AC_5: HarvestRecord, DiseaseInfection, and CellPlanting lifecycle fields are untouched", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const species = await createFastSpecies(prisma, "test-override-ac5");
    const plant = await prisma.plant.create({ data: { commonName: "Test Plant", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });

    const harvestRecord = await prisma.harvestRecord.create({
      data: { cellPlantingId: planting.id, plantId: plant.id, amount: 2, unit: "item", harvestedAt: new Date() },
    });
    const infection = await prisma.diseaseInfection.create({
      data: { cellPlantingId: planting.id, diseaseKey: "powdery-mildew", severity: 0.4, startedAt: new Date() },
    });
    const plantedAtBefore = planting.plantedAt;
    const removedAtBefore = planting.removedAt;

    await overridePlantingStage(prisma, { cellPlantingId: planting.id, targetStage: "FRUITING" });

    const harvestAfter = await prisma.harvestRecord.findUniqueOrThrow({ where: { id: harvestRecord.id } });
    const infectionAfter = await prisma.diseaseInfection.findUniqueOrThrow({ where: { id: infection.id } });
    const plantingAfter = await prisma.cellPlanting.findUniqueOrThrow({ where: { id: planting.id } });

    expect(harvestAfter).toEqual(harvestRecord);
    expect(infectionAfter).toEqual(infection);
    expect(plantingAfter.plantedAt).toEqual(plantedAtBefore);
    expect(plantingAfter.removedAt).toEqual(removedAtBefore);
  });

  it("T-SPEC-GROWTH-005-AC-AC_4b: an unknown cellPlantingId is rejected", async () => {
    await expect(
      overridePlantingStage(prisma, { cellPlantingId: "does-not-exist", targetStage: "VEGETATIVE" }),
    ).rejects.toThrow(PlantingNotFoundError);
  });

  it("T-SPEC-GROWTH-005-removed-planting-guard: a removed planting can't be overridden", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const species = await createFastSpecies(prisma, "test-override-removed");
    const plant = await prisma.plant.create({ data: { commonName: "Test Plant", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    // removeCell()'s "remove" event is what actually sets removedAt (harvest()
    // only advances GROWING -> HARVESTED status, it doesn't vacate the cell) —
    // valid straight from PLANTED, so no catch-up is needed first.
    await removeCell(prisma, { bedId: bed.id, column: 1, row: 1 });

    await expect(
      overridePlantingStage(prisma, { cellPlantingId: planting.id, targetStage: "VEGETATIVE" }),
    ).rejects.toThrow(PlantingRemovedError);

    const row = await prisma.plantingBiologyState.findUnique({ where: { cellPlantingId: planting.id } });
    expect(row).toBeNull();
  });
});
