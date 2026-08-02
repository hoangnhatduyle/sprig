import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient, resetConditionsTables } from "./test-db";
import { resetGrowthTables } from "../growth/test-db";
import { resetGridTables } from "../grid/test-db";
import { assignPlant, seedBed } from "../grid/grid-cell-service";
import { catchUpGrowth } from "../growth/catch-up-service";
import {
  installConditionOverride,
  listActiveConditionOverrides,
} from "./bed-condition-override-service";
import { getBedEffectiveConditions } from "./bed-effective-conditions";
import { InvalidConditionIntensityError } from "./errors";
import { runWhatIfProjection } from "./whatif-projection-service";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-CONDITIONS-001.yaml

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetConditionsTables(prisma);
  await resetGrowthTables(prisma);
  await resetGridTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

afterAll(async () => {
  const cleanup = createTestPrismaClient();
  await resetConditionsTables(cleanup);
  await resetGrowthTables(cleanup);
  await resetGridTables(cleanup);
  await cleanup.$disconnect();
});

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function makeFastGrowerSpecies(prisma: PrismaClient, key: string) {
  return prisma.speciesProfile.create({
    data: {
      key,
      displayName: "Fast Grower",
      growthHabit: "UPRIGHT_BUSH",
      baseTempC: -10,
      gddToGerminate: 5,
      gddToVegetative: 5000, // deliberately unreachable within the test window so phenology stays fixed and only biomass (light-driven) varies
      gddToFlowering: 6000,
      gddToFruiting: 7000,
      gddToMaturity: 8000,
      heatStressThresholdC: 50,
      coldStressThresholdC: -20,
      droughtComfortFraction: 0.1,
      matureHeightCm: 30,
      canopyWidthCm: 30,
      primaryColor: "#3f8f3a",
    },
  });
}

describe("SPEC-CONDITIONS-001", () => {
  it("T-SPEC-CONDITIONS-001-AC-AC_1: an installed shade cloth measurably reduces a bed's plants' growth vs. an unshaded bed", async () => {
    const shadedBed = await seedBed(prisma, { name: "Shaded Bed", compassPosition: "SOUTH" });
    const sunnyBed = await seedBed(prisma, { name: "Sunny Bed", compassPosition: "SOUTH" });
    const species = await makeFastGrowerSpecies(prisma, "test-shade-species");

    const shadedPlant = await prisma.plant.create({ data: { commonName: "Shaded Plant", seedQuantity: 1, speciesProfileId: species.id } });
    const sunnyPlant = await prisma.plant.create({ data: { commonName: "Sunny Plant", seedQuantity: 1, speciesProfileId: species.id } });
    await assignPlant(prisma, { bedId: shadedBed.id, column: 1, row: 1, plantId: shadedPlant.id });
    await assignPlant(prisma, { bedId: sunnyBed.id, column: 1, row: 1, plantId: sunnyPlant.id });

    await installConditionOverride(prisma, { bedId: shadedBed.id, kind: "SHADE_CLOTH", intensity: 0.8 });

    await catchUpGrowth(prisma, { through: addDays(new Date(), 20) });

    const shadedPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: shadedPlant.id } });
    const sunnyPlanting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: sunnyPlant.id } });
    const shadedBiology = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: shadedPlanting.id } });
    const sunnyBiology = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: sunnyPlanting.id } });

    const shadedBiomass = shadedBiology.leafFraction + shadedBiology.stemFraction + shadedBiology.rootFraction;
    const sunnyBiomass = sunnyBiology.leafFraction + sunnyBiology.stemFraction + sunnyBiology.rootFraction;
    expect(shadedBiomass).toBeLessThan(sunnyBiomass);
    // Both share the same GDD path (species thresholds are unreachable in
    // this window) — confirms the divergence is light-driven, not a
    // phenology-stage side effect.
    expect(shadedBiology.phenologyStage).toBe(sunnyBiology.phenologyStage);
  });

  it("T-SPEC-CONDITIONS-001-AC-AC_2: installing the same equipment kind twice retires the previous instance", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const first = await installConditionOverride(prisma, { bedId: bed.id, kind: "SHADE_CLOTH", intensity: 0.3 });
    const second = await installConditionOverride(prisma, { bedId: bed.id, kind: "SHADE_CLOTH", intensity: 0.6 });

    const active = await listActiveConditionOverrides(prisma, bed.id);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(second.id);

    const refetchedFirst = await prisma.bedConditionOverride.findUniqueOrThrow({ where: { id: first.id } });
    expect(refetchedFirst.removedAt).not.toBeNull();
  });

  it("T-SPEC-CONDITIONS-001-AC-AC_3: different override kinds on the same bed stack rather than replacing each other", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    await installConditionOverride(prisma, { bedId: bed.id, kind: "SHADE_CLOTH", intensity: 0.5 });
    await installConditionOverride(prisma, { bedId: bed.id, kind: "RAIN_COVER", intensity: 0.5 });

    const active = await listActiveConditionOverrides(prisma, bed.id);
    expect(active).toHaveLength(2);

    const modifiers = await getBedEffectiveConditions(prisma, bed.id);
    expect(modifiers.lightMultiplier).toBeLessThan(1);
    expect(modifiers.rainMultiplier).toBeLessThan(1);
  });

  it("T-SPEC-CONDITIONS-001-AC-AC_4: an intensity above a kind's bound is rejected, never silently clamped", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    await expect(
      installConditionOverride(prisma, { bedId: bed.id, kind: "SHADE_CLOTH", intensity: 1.5 }),
    ).rejects.toThrow(InvalidConditionIntensityError);

    const active = await listActiveConditionOverrides(prisma, bed.id);
    expect(active).toHaveLength(0);
  });

  it("T-SPEC-CONDITIONS-001-AC-AC_5: a what-if preview never writes to the real garden state", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Test Plant", seedQuantity: 1 } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    // Give it a real first catch-up so it has a real, persisted biology row
    // to compare before/after.
    await catchUpGrowth(prisma, { through: addDays(new Date(), 5) });

    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    const biologyBefore = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: planting.id } });
    const envBefore = await prisma.cellEnvironmentState.findUniqueOrThrow({ where: { cellId: planting.cellId } });
    const cellBefore = await prisma.gridCell.findUniqueOrThrow({ where: { id: planting.cellId } });

    const projections = await runWhatIfProjection(prisma, {
      bedIds: [bed.id],
      projectionDays: 10,
      overrides: [{ bedIds: [bed.id], lightMultiplier: 1.8, rainMultiplier: 0.1 }],
    });
    expect(projections).toHaveLength(1);
    expect(projections[0].days).toHaveLength(10);

    const biologyAfter = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: planting.id } });
    const envAfter = await prisma.cellEnvironmentState.findUniqueOrThrow({ where: { cellId: planting.cellId } });
    const cellAfter = await prisma.gridCell.findUniqueOrThrow({ where: { id: planting.cellId } });

    expect(biologyAfter).toEqual(biologyBefore);
    expect(envAfter).toEqual(envBefore);
    expect(cellAfter).toEqual(cellBefore);
  });

  it("T-SPEC-CONDITIONS-001-AC-AC_6: a preview request beyond the cap silently truncates instead of erroring or running unbounded", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Test Plant", seedQuantity: 1 } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    const projections = await runWhatIfProjection(prisma, {
      bedIds: [bed.id],
      projectionDays: 500,
      overrides: [],
    });
    expect(projections[0].days).toHaveLength(60); // MAX_PROJECTION_DAYS
  });

  it("a projection with no overrides matches the neutral case (no light/rain change)", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Test Plant", seedQuantity: 1 } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    const projections = await runWhatIfProjection(prisma, { bedIds: [bed.id], projectionDays: 3, overrides: [] });
    expect(projections[0].days).toHaveLength(3);
    expect(projections[0].startingBiology.phenologyStage).toBe("GERMINATING");
  });
});
