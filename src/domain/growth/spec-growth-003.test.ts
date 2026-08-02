import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient, resetGrowthTables } from "./test-db";
import { resetGridTables } from "../grid/test-db";
import { assignPlant, seedBed } from "../grid/grid-cell-service";
import { catchUpGrowth } from "./catch-up-service";
import { applyWeedingToCell } from "@/domain/soil/care-actions-service";
import { applyFungicideToCell } from "@/domain/disease/disease-action-service";
import { applyPesticideToBed, releasePredatorsToBed } from "@/domain/pests/pest-action-service";
import { runWhatIfProjection } from "@/domain/conditions/whatif-projection-service";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-GROWTH-003.yaml

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

async function createFastSpecies(prisma: PrismaClient, key: string) {
  return prisma.speciesProfile.create({
    data: {
      key,
      displayName: key,
      growthHabit: "UPRIGHT_BUSH",
      baseTempC: -10,
      gddToGerminate: 1,
      gddToVegetative: 2,
      gddToFlowering: 100_000,
      gddToFruiting: 100_001,
      gddToMaturity: 100_002,
      heatStressThresholdC: 50,
      coldStressThresholdC: -20,
      droughtComfortFraction: 0.1,
      matureHeightCm: 30,
      canopyWidthCm: 30,
      primaryColor: "#3f8f3a",
    },
  });
}

describe("SPEC-GROWTH-003", () => {
  it("T-SPEC-GROWTH-003-AC-AC_1/2: an active disease infection measurably slows growth vs. an uninfected planting", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const species = await createFastSpecies(prisma, "test-disease-a");
    // The infection is seeded directly below (bypassing the host-susceptibility
    // infection roll entirely) — this test is about EFFECT wiring
    // (effectForActiveInfection doesn't consult host susceptibility), not
    // about which species can catch powdery mildew.
    const healthyPlant = await prisma.plant.create({ data: { commonName: "Healthy", seedQuantity: 5, speciesProfileId: species.id } });
    const infectedPlant = await prisma.plant.create({ data: { commonName: "Infected", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: healthyPlant.id });
    await assignPlant(prisma, { bedId: bed.id, column: 3, row: 1, plantId: infectedPlant.id });

    // First catch-up so both plantings have a real biology row and past
    // GERMINATING before the infection effect can meaningfully matter.
    await catchUpGrowth(prisma, { through: addDays(new Date(), 5) });

    const infectedPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: infectedPlant.id } });
    await prisma.diseaseInfection.create({
      data: { cellPlantingId: infectedPlanting.id, diseaseKey: "powdery-mildew", severity: 0.95, startedAt: new Date() },
    });

    await catchUpGrowth(prisma, { through: addDays(new Date(), 15) });

    const healthyPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: healthyPlant.id } });
    const healthyBiology = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: healthyPlanting.id } });
    const infectedBiology = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: infectedPlanting.id } });

    expect(infectedBiology.leafFraction).toBeLessThan(healthyBiology.leafFraction);
  });

  it("T-SPEC-GROWTH-003-AC-AC_1: fungicide measurably reduces a cell's active infection severity", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Sick Plant", seedQuantity: 1 } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    await prisma.diseaseInfection.create({
      data: { cellPlantingId: planting.id, diseaseKey: "blight", severity: 0.8, startedAt: new Date() },
    });

    await applyFungicideToCell(prisma, { bedId: bed.id, column: 1, row: 1 });

    const infection = await prisma.diseaseInfection.findFirstOrThrow({ where: { cellPlantingId: planting.id } });
    expect(infection.severity).toBeLessThan(0.8);
  });

  it("T-SPEC-GROWTH-003-AC-AC_3: a persisted bed-level pest population measurably damages growth vs. a pest-free bed", async () => {
    const pestBed = await seedBed(prisma, { name: "Pest Bed", compassPosition: "SOUTH" });
    const cleanBed = await seedBed(prisma, { name: "Clean Bed", compassPosition: "SOUTH" });
    const species = await createFastSpecies(prisma, "test-pest-damage");

    const pestPlant = await prisma.plant.create({ data: { commonName: "Buggy", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: pestBed.id, column: 1, row: 1, plantId: pestPlant.id });
    const cleanPlant = await prisma.plant.create({ data: { commonName: "Clean", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: cleanBed.id, column: 1, row: 1, plantId: cleanPlant.id });

    await prisma.pestPopulation.create({ data: { bedId: pestBed.id, pestKey: "caterpillar", population: 4 } });

    await catchUpGrowth(prisma, { through: addDays(new Date(), 15) });

    const pestPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: pestPlant.id } });
    const cleanPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: cleanPlant.id } });
    const pestBiology = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: pestPlanting.id } });
    const cleanBiology = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: cleanPlanting.id } });

    expect(pestBiology.leafFraction).toBeLessThan(cleanBiology.leafFraction);
  });

  it("T-SPEC-GROWTH-003: pesticide reduces the targeted pest, and broad-spectrum also suppresses predators", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    await prisma.pestPopulation.create({ data: { bedId: bed.id, pestKey: "aphid", population: 4 } });
    await prisma.predatorPopulation.create({ data: { bedId: bed.id, predatorKey: "ladybug", population: 2 } });

    await applyPesticideToBed(prisma, { bedId: bed.id, pestKey: "aphid", broadSpectrum: true });

    const pest = await prisma.pestPopulation.findUniqueOrThrow({ where: { bedId_pestKey: { bedId: bed.id, pestKey: "aphid" } } });
    const predator = await prisma.predatorPopulation.findUniqueOrThrow({
      where: { bedId_predatorKey: { bedId: bed.id, predatorKey: "ladybug" } },
    });
    expect(pest.population).toBeLessThan(4);
    expect(predator.population).toBeLessThan(2);
  });

  it("T-SPEC-GROWTH-003: releasing predators adds a bounded amount to the bed's population", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    await releasePredatorsToBed(prisma, { bedId: bed.id, predatorKey: "ladybug", amount: 2 });
    const predator = await prisma.predatorPopulation.findUniqueOrThrow({
      where: { bedId_predatorKey: { bedId: bed.id, predatorKey: "ladybug" } },
    });
    expect(predator.population).toBe(2);
  });

  it("T-SPEC-GROWTH-003-AC-AC_6: weeding measurably reduces a cell's weed pressure", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Weedy Cell Plant", seedQuantity: 1 } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    await prisma.cellEnvironmentState.create({ data: { cellId: planting.cellId, weedPressureFraction: 0.6 } });

    const after = await applyWeedingToCell(prisma, { bedId: bed.id, column: 1, row: 1 });

    expect(after.weedPressureFraction).toBeLessThan(0.6);
  });

  it("T-SPEC-GROWTH-003-AC-AC_7: a what-if preview never writes DiseaseInfection/PestPopulation/PredatorPopulation rows", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Test Plant", seedQuantity: 1 } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    await catchUpGrowth(prisma, { through: addDays(new Date(), 5) });

    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    await prisma.diseaseInfection.create({
      data: { cellPlantingId: planting.id, diseaseKey: "blight", severity: 0.5, startedAt: new Date() },
    });
    // catchUpGrowth above already lazily created PestPopulation rows for
    // every catalog pest in this bed (pest-service.ts's per-bed pass runs
    // for any bed with a planting) — upsert here rather than create to set
    // a nonzero population regardless of whether that row already exists.
    await prisma.pestPopulation.upsert({
      where: { bedId_pestKey: { bedId: bed.id, pestKey: "aphid" } },
      update: { population: 3 },
      create: { bedId: bed.id, pestKey: "aphid", population: 3 },
    });

    const infectionsBefore = await prisma.diseaseInfection.findMany();
    const pestsBefore = await prisma.pestPopulation.findMany();
    const predatorsBefore = await prisma.predatorPopulation.findMany();

    await runWhatIfProjection(prisma, {
      bedIds: [bed.id],
      projectionDays: 10,
      overrides: [{ bedIds: [bed.id], lightMultiplier: 1.5 }],
    });

    expect(await prisma.diseaseInfection.findMany()).toEqual(infectionsBefore);
    expect(await prisma.pestPopulation.findMany()).toEqual(pestsBefore);
    expect(await prisma.predatorPopulation.findMany()).toEqual(predatorsBefore);
  });
});
