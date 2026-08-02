import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient, resetGridTables } from "./test-db";
import { resetGrowthTables } from "../growth/test-db";
import { resetConditionsTables } from "../conditions/test-db";
import { addCompanionPlant, assignPlant, getGardenSnapshot, seedBed } from "./grid-cell-service";
import { installConditionOverride, removeConditionOverride } from "../conditions/bed-condition-override-service";

// Phase C fixture: a minimal, fast-maturing SpeciesProfile row, same shape
// as growth/spec-growth-003.test.ts's createFastSpecies — the exact GDD/
// stress values don't matter for these tests, only that a Plant can carry a
// speciesProfileId with a specific `key`.
async function createSpecies(prisma: PrismaClient, key: string) {
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

// Traces to SPEC-SURFACE-001: GardenSnapshot.beds[].equipment and
// GardenSnapshot.environment, added so the client can see equipment and
// weather/clock state that previously only lived server-side (ConditionsPanel's
// own independent fetch loop, and nowhere at all for weather/clock).

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

describe("getGardenSnapshot — equipment", () => {
  it("surfaces an installed BedConditionOverride as bed.equipment", async () => {
    const bed = await seedBed(prisma, { name: "Test Bed", compassPosition: "SOUTH" });
    await installConditionOverride(prisma, { bedId: bed.id, kind: "SHADE_CLOTH", intensity: 0.4 });

    const snapshot = await getGardenSnapshot(prisma);

    const snapshotBed = snapshot.beds.find((candidate) => candidate.id === bed.id)!;
    expect(snapshotBed.equipment).toHaveLength(1);
    expect(snapshotBed.equipment[0]).toMatchObject({ kind: "SHADE_CLOTH", intensity: 0.4 });
  });

  it("excludes a removed override", async () => {
    const bed = await seedBed(prisma, { name: "Test Bed", compassPosition: "SOUTH" });
    const override = await installConditionOverride(prisma, { bedId: bed.id, kind: "RAIN_COVER", intensity: 0.5 });
    await removeConditionOverride(prisma, override.id);

    const snapshot = await getGardenSnapshot(prisma);

    const snapshotBed = snapshot.beds.find((candidate) => candidate.id === bed.id)!;
    expect(snapshotBed.equipment).toHaveLength(0);
  });

  it("gives a bed with no equipment an empty array, not null/undefined", async () => {
    await seedBed(prisma, { name: "Bare Bed", compassPosition: "SOUTH" });

    const snapshot = await getGardenSnapshot(prisma);

    expect(snapshot.beds[0].equipment).toEqual([]);
  });
});

describe("getGardenSnapshot — environment", () => {
  it("returns a populated environment with rate 1 when no SimClockEpoch exists yet", async () => {
    await seedBed(prisma, { name: "Test Bed", compassPosition: "SOUTH" });

    const snapshot = await getGardenSnapshot(prisma);

    expect(snapshot.environment.clockRate).toBe(1);
    expect(snapshot.environment.weather).toBeNull();
    expect(["DAWN", "DAY", "DUSK", "NIGHT"]).toContain(snapshot.environment.phase);
    expect(Number.isFinite(snapshot.environment.sunAltitudeRad)).toBe(true);
    expect(Number.isFinite(snapshot.environment.sunAzimuthRad)).toBe(true);
  });
});

// Phase C: soil texture, the corrected nutrient set, and same-cell
// companion-effect derivation.
describe("getGardenSnapshot — soil profile", () => {
  it("surfaces a bed's SoilProfile as soilProfile", async () => {
    const bed = await seedBed(prisma, { name: "Test Bed", compassPosition: "SOUTH" });
    await prisma.soilProfile.create({
      data: { bedId: bed.id, sandPct: 60, siltPct: 25, clayPct: 15, fieldCapacityFraction: 0.28, wiltingPointFraction: 0.09 },
    });

    const snapshot = await getGardenSnapshot(prisma);

    const snapshotBed = snapshot.beds.find((candidate) => candidate.id === bed.id)!;
    expect(snapshotBed.soilProfile).toMatchObject({
      sandPct: 60,
      siltPct: 25,
      clayPct: 15,
      fieldCapacityFraction: 0.28,
      wiltingPointFraction: 0.09,
    });
  });

  it("gives a bed with no SoilProfile row null, not an error", async () => {
    await seedBed(prisma, { name: "Bare Bed", compassPosition: "SOUTH" });

    const snapshot = await getGardenSnapshot(prisma);

    expect(snapshot.beds[0].soilProfile).toBeNull();
  });
});

describe("getGardenSnapshot — cell environment", () => {
  it("surfaces the full corrected nutrient set (including calcium) and the previously-unexposed soil fields", async () => {
    const bed = await seedBed(prisma, { name: "Test Bed", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Tomato" } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const cell = await prisma.gridCell.findFirstOrThrow({ where: { bedId: bed.id, column: 1, row: 1 } });
    await prisma.cellEnvironmentState.create({
      data: {
        cellId: cell.id,
        soilMoistureFraction: 0.4,
        soilTempC: 19,
        nitrogenPoolFraction: 0.6,
        phosphorusPoolFraction: 0.6,
        potassiumPoolFraction: 0.6,
        // The bug this phase fixes: CellPicker's old inline check omitted
        // calcium even though the field was already on the read model.
        calciumPoolFraction: 0.1,
        micronutrientIndexFraction: 0.6,
        residueOrganicMatterPool: 0.3,
        mulchDepthMm: 20,
        daysNearSaturation: 2,
        weedPressureFraction: 0.25,
      },
    });

    const snapshot = await getGardenSnapshot(prisma);

    const snapshotCell = snapshot.beds[0].cells.find((c) => c.column === 1 && c.row === 1)!;
    expect(snapshotCell.environment).toMatchObject({
      calciumPoolFraction: 0.1,
      soilTempC: 19,
      residueOrganicMatterPool: 0.3,
      daysNearSaturation: 2,
      weedPressureFraction: 0.25,
    });
    expect(Number.isFinite(snapshotCell.environment!.evapotranspirationMm)).toBe(true);
  });
});

describe("getGardenSnapshot — companion effects", () => {
  it("computes same-cell companion effects on the receiving planting, not the source", async () => {
    const bed = await seedBed(prisma, { name: "Test Bed", compassPosition: "SOUTH" });
    const beanSpecies = await createSpecies(prisma, "pole-bean");
    const lettuceSpecies = await createSpecies(prisma, "test-lettuce");
    const lettuce = await prisma.plant.create({ data: { commonName: "Lettuce", speciesProfileId: lettuceSpecies.id } });
    const bean = await prisma.plant.create({ data: { commonName: "Pole Bean", speciesProfileId: beanSpecies.id } });
    const loc = { bedId: bed.id, column: 1, row: 1 };

    await assignPlant(prisma, { ...loc, plantId: lettuce.id });
    await addCompanionPlant(prisma, { ...loc, plantId: bean.id });

    const snapshot = await getGardenSnapshot(prisma);
    const cell = snapshot.beds[0].cells.find((c) => c.column === 1 && c.row === 1)!;
    const lettucePlanting = cell.plantings.find((p) => p.plantId === lettuce.id)!;
    const beanPlanting = cell.plantings.find((p) => p.plantId === bean.id)!;

    expect(lettucePlanting.companionEffects).toEqual([{ kind: "NITROGEN_FIX", sourceSpeciesKey: "pole-bean" }]);
    // The bean is the source of the effect, not a recipient of it from lettuce.
    expect(beanPlanting.companionEffects).toEqual([]);
  });

  it("gives a planting with no companions an empty companionEffects array", async () => {
    const bed = await seedBed(prisma, { name: "Test Bed", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Solo Tomato" } });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    const snapshot = await getGardenSnapshot(prisma);
    const cell = snapshot.beds[0].cells.find((c) => c.column === 1 && c.row === 1)!;

    expect(cell.plantings[0].companionEffects).toEqual([]);
  });
});
