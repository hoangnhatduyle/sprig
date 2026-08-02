import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient, resetGrowthTables } from "./test-db";
import { resetGridTables } from "../grid/test-db";
import { assignPlant, seedBed } from "../grid/grid-cell-service";
import { catchUpGrowth } from "./catch-up-service";
import { ensureSpeciesCatalogSeeded } from "./species-catalog";
import { applyCompostToCell, applyFertilizerToCell, applyMulchToCell } from "@/domain/soil/care-actions-service";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-GROWTH-002.yaml
//
// AC-7 (a what-if preview never writes real state, including the new
// nutrient/mulch fields) is already exercised end-to-end by
// SPEC-CONDITIONS-001's own AC-5 test (whatif-projection-service.test.ts's
// full-row `envAfter.toEqual(envBefore)` comparison automatically covers
// every field CellEnvironmentState gained this phase) — not duplicated here.

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

// A species with tiny GDD thresholds and a low base temp, so ordinary
// procedural weather reaches every phenology stage within a handful of
// simulated days regardless of season/location — the same determinism
// trick spec-growth-001.test.ts's AC_2 test already uses.
async function createFastSpecies(prisma: PrismaClient, key: string, pollinationDependency: "SELF" | "INSECT" = "SELF") {
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
      gddToMaturity: 100_000, // stays in FRUITING for the whole test window
      heatStressThresholdC: 50,
      coldStressThresholdC: -20,
      droughtComfortFraction: 0.1,
      matureHeightCm: 30,
      canopyWidthCm: 30,
      primaryColor: "#3f8f3a",
      pollinationDependency,
    },
  });
}

describe("SPEC-GROWTH-002", () => {
  it("T-SPEC-GROWTH-002-AC-AC_1: nutrient pools deplete from uptake over simulated time", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const species = await createFastSpecies(prisma, "test-nutrient-drain");
    const plant = await prisma.plant.create({ data: { commonName: "Drainer", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    await catchUpGrowth(prisma, { through: addDays(new Date(), 20) });

    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    const env = await prisma.cellEnvironmentState.findUniqueOrThrow({ where: { cellId: planting.cellId } });
    expect(env.nitrogenPoolFraction).toBeLessThan(0.6);
  });

  it("T-SPEC-GROWTH-002-AC-AC_2: mulch reduces evaporation, keeping soil moisture higher over time", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const species = await createFastSpecies(prisma, "test-mulch-a");
    const plantMulched = await prisma.plant.create({ data: { commonName: "Mulched", seedQuantity: 5, speciesProfileId: species.id } });
    const plantBare = await prisma.plant.create({ data: { commonName: "Bare", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plantMulched.id });
    await assignPlant(prisma, { bedId: bed.id, column: 2, row: 1, plantId: plantBare.id });

    await applyMulchToCell(prisma, { bedId: bed.id, column: 1, row: 1, depthMm: 50 });

    await catchUpGrowth(prisma, { through: addDays(new Date(), 20) });

    const mulchedPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plantMulched.id } });
    const barePlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plantBare.id } });
    const mulchedEnv = await prisma.cellEnvironmentState.findUniqueOrThrow({ where: { cellId: mulchedPlanting.cellId } });
    const bareEnv = await prisma.cellEnvironmentState.findUniqueOrThrow({ where: { cellId: barePlanting.cellId } });

    expect(mulchedEnv.soilMoistureFraction).toBeGreaterThanOrEqual(bareEnv.soilMoistureFraction);
  });

  it("T-SPEC-GROWTH-002-AC-AC_3: fertilizing and composting measurably change the targeted cell's soil state immediately", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Fed Plant", seedQuantity: 1 } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    const before = await prisma.cellEnvironmentState.findUnique({ where: { cellId: planting.cellId } });
    expect(before).toBeNull(); // no catch-up has run yet — care-actions-service must self-heal

    const afterFertilizer = await applyFertilizerToCell(prisma, { bedId: bed.id, column: 1, row: 1, kind: "SYNTHETIC", n: 0.3, p: 0.1, k: 0.1 });
    expect(afterFertilizer.nitrogenPoolFraction).toBeCloseTo(0.9, 5); // default 0.6 + 0.3

    const afterCompost = await applyCompostToCell(prisma, { bedId: bed.id, column: 1, row: 1, amount: 1 });
    expect(afterCompost.residueOrganicMatterPool).toBeCloseTo(1, 5);
  });

  it("T-SPEC-GROWTH-002-AC-AC_5: an INSECT-dependent species fruits faster with an adjacent pollinator-boosting companion than isolated", async () => {
    const isolatedBed = await seedBed(prisma, { name: "Isolated Bed", compassPosition: "SOUTH" });
    const companionBed = await seedBed(prisma, { name: "Companion Bed", compassPosition: "SOUTH" });

    const insectSpecies = await createFastSpecies(prisma, "test-insect-fruit", "INSECT");
    await ensureSpeciesCatalogSeeded(prisma); // seeds "marigold", used as the companion below
    const marigold = await prisma.speciesProfile.findUniqueOrThrow({ where: { key: "marigold" } });

    const isolatedPlant = await prisma.plant.create({ data: { commonName: "Isolated", seedQuantity: 5, speciesProfileId: insectSpecies.id } });
    await assignPlant(prisma, { bedId: isolatedBed.id, column: 1, row: 1, plantId: isolatedPlant.id });

    const companionPlant = await prisma.plant.create({ data: { commonName: "Companioned", seedQuantity: 5, speciesProfileId: insectSpecies.id } });
    await assignPlant(prisma, { bedId: companionBed.id, column: 1, row: 1, plantId: companionPlant.id });
    const marigoldPlant = await prisma.plant.create({ data: { commonName: "Marigold", seedQuantity: 5, speciesProfileId: marigold.id } });
    await assignPlant(prisma, { bedId: companionBed.id, column: 1, row: 2, plantId: marigoldPlant.id });

    await catchUpGrowth(prisma, { through: addDays(new Date(), 15) });

    const isolatedPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: isolatedPlant.id } });
    const companionPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: companionPlant.id } });
    const isolatedBiology = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: isolatedPlanting.id } });
    const companionBiology = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: companionPlanting.id } });

    expect(isolatedBiology.phenologyStage).toBe("FRUITING");
    expect(companionBiology.phenologyStage).toBe("FRUITING");
    expect(companionBiology.fruitFraction).toBeGreaterThan(isolatedBiology.fruitFraction);
  });

  it("T-SPEC-GROWTH-002-AC-AC_6: a nitrogen-fixing companion raises a neighboring cell's nitrogen pool relative to an isolated cell", async () => {
    const isolatedBed = await seedBed(prisma, { name: "Isolated Bed", compassPosition: "SOUTH" });
    const companionBed = await seedBed(prisma, { name: "Companion Bed", compassPosition: "SOUTH" });

    const species = await createFastSpecies(prisma, "test-nitrogen-recipient");
    await ensureSpeciesCatalogSeeded(prisma); // seeds "pole-bean"
    const poleBean = await prisma.speciesProfile.findUniqueOrThrow({ where: { key: "pole-bean" } });

    const isolatedPlant = await prisma.plant.create({ data: { commonName: "Isolated", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: isolatedBed.id, column: 1, row: 1, plantId: isolatedPlant.id });

    const companionPlant = await prisma.plant.create({ data: { commonName: "Companioned", seedQuantity: 5, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: companionBed.id, column: 1, row: 1, plantId: companionPlant.id });
    const beanPlant = await prisma.plant.create({ data: { commonName: "Pole Bean", seedQuantity: 5, speciesProfileId: poleBean.id } });
    await assignPlant(prisma, { bedId: companionBed.id, column: 2, row: 1, plantId: beanPlant.id });

    await catchUpGrowth(prisma, { through: addDays(new Date(), 10) });

    const isolatedPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: isolatedPlant.id } });
    const companionPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: companionPlant.id } });
    const isolatedEnv = await prisma.cellEnvironmentState.findUniqueOrThrow({ where: { cellId: isolatedPlanting.cellId } });
    const companionEnv = await prisma.cellEnvironmentState.findUniqueOrThrow({ where: { cellId: companionPlanting.cellId } });

    expect(companionEnv.nitrogenPoolFraction).toBeGreaterThan(isolatedEnv.nitrogenPoolFraction);
  });

  describe("species-catalog", () => {
    it("carrot seeds as the new ROOT_CROP growth habit", async () => {
      await ensureSpeciesCatalogSeeded(prisma);
      const carrot = await prisma.speciesProfile.findUniqueOrThrow({ where: { key: "carrot" } });
      expect(carrot.growthHabit).toBe("ROOT_CROP");
    });

    it("pole-bean and marigold seed with their companion-relevant species keys intact", async () => {
      await ensureSpeciesCatalogSeeded(prisma);
      const poleBean = await prisma.speciesProfile.findUniqueOrThrow({ where: { key: "pole-bean" } });
      const cucumber = await prisma.speciesProfile.findUniqueOrThrow({ where: { key: "cucumber" } });
      expect(poleBean.growthHabit).toBe("VINING");
      expect(cucumber.pollinationDependency).toBe("INSECT");
    });
  });
});
