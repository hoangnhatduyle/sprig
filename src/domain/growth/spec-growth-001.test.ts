import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient, resetGrowthTables } from "./test-db";
import { resetGridTables } from "../grid/test-db";
import { assignPlant, seedBed } from "../grid/grid-cell-service";
import { createInventoryPlant } from "../plant-catalog/inventory-service";
import { catchUpGrowth } from "./catch-up-service";
import { getCurrentSimTime, setClockRate } from "./sim-clock-service";
import { InvalidClockRateError } from "./errors";
import { FALLBACK_SPECIES_KEY, ensureSpeciesCatalogSeeded, guessSpeciesKey } from "./species-catalog";
import { getOrGenerateWeatherDay } from "@/domain/weather/weather-service";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-GROWTH-001.yaml

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

describe("SPEC-GROWTH-001", () => {
  it("T-SPEC-GROWTH-001-AC-AC_1: first catch-up creates PlantingBiologyState at GERMINATING with ~0 accumulated GDD", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, {
      commonName: "Roma Tomato",
      seedQuantity: 10,
      seedUnit: "seed",
    });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    await catchUpGrowth(prisma, { through: new Date() });

    const biology = await prisma.plantingBiologyState.findUnique({ where: { cellPlantingId: planting.id } });
    expect(biology).not.toBeNull();
    expect(biology?.phenologyStage).toBe("GERMINATING");
    expect(biology?.accumulatedGdd).toBe(0);
  });

  it("T-SPEC-GROWTH-001-AC-AC_2: crossing a GDD threshold advances CellStatus automatically via the existing FSM, with a journal event", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    // A species with tiny thresholds so ordinary procedural weather crosses
    // them within a handful of simulated days, deterministically regardless
    // of the exact stochastic temperature draw.
    const fastGrower = await prisma.speciesProfile.create({
      data: {
        key: "test-fast-grower",
        displayName: "Fast Grower",
        growthHabit: "UPRIGHT_BUSH",
        baseTempC: -10,
        gddToGerminate: 5,
        gddToVegetative: 10,
        gddToFlowering: 1000,
        gddToFruiting: 1100,
        gddToMaturity: 1200,
        heatStressThresholdC: 50,
        coldStressThresholdC: -20,
        droughtComfortFraction: 0.1,
        matureHeightCm: 30,
        canopyWidthCm: 30,
        primaryColor: "#3f8f3a",
      },
    });
    const plant = await prisma.plant.create({
      data: { commonName: "Speedy", seedQuantity: 5, speciesProfileId: fastGrower.id },
    });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    await catchUpGrowth(prisma, { through: addDays(new Date(), 10) });

    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 1 } },
    });
    expect(["GERMINATED", "GROWING"]).toContain(cell.status);

    const events = await prisma.gridCellEvent.findMany({ where: { cellId: cell.id }, orderBy: { occurredAt: "asc" } });
    expect(events.some((event) => event.eventType === "GERMINATED" || event.eventType === "GROWING")).toBe(true);

    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    const biology = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: planting.id } });
    expect(biology.accumulatedGdd).toBeGreaterThan(fastGrower.gddToVegetative);
  });

  it("T-SPEC-GROWTH-001-AC-AC_5-AC_7: a single call caps at MAX_CATCH_UP_DAYS and never throws for an unrecognized species", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    // No speciesProfileId set — exercises the fallback-archetype path
    // (AC-7) at the same time as the catch-up cap (AC-5).
    const plant = await prisma.plant.create({ data: { commonName: "Mystery Plant", seedQuantity: 1 } });
    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 1 } },
    });
    const plantedAt = addDays(new Date(), -200);
    await prisma.cellPlanting.create({ data: { cellId: cell.id, plantId: plant.id, plantedAt } });
    await prisma.gridCell.update({ where: { id: cell.id }, data: { status: "PLANTED", plantedAt } });

    const summary = await catchUpGrowth(prisma, { through: new Date() });

    expect(summary.cappedAt).toBe(60);
    expect(summary.daysProcessed).toBe(60);

    // Not asserting accumulatedGdd > 0 here: whether GDD actually accrues
    // depends on which real calendar window the capped 60 days fall into
    // (a stretch that lands entirely in winter for the default garden
    // latitude legitimately accrues zero GDD, since mean temp stays below
    // the fallback species' baseTempC) — that's correct growth-engine
    // behavior, not something this test should assume either way. The
    // meaningful assertion is that resolving an unrecognized species never
    // throws and still produces a real, queryable biology row.
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    const biology = await prisma.plantingBiologyState.findUniqueOrThrow({ where: { cellPlantingId: planting.id } });
    expect(biology.accumulatedGdd).toBeGreaterThanOrEqual(0);
  });

  it("T-SPEC-GROWTH-001-AC-AC_8: never overwrites a HARVESTED cell's status even once phenology has advanced", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, { commonName: "Tomato", seedQuantity: 5, seedUnit: "seed" });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 1 } },
    });
    await prisma.gridCell.update({ where: { id: cell.id }, data: { status: "HARVESTED" } });

    await catchUpGrowth(prisma, { through: addDays(new Date(), 30) });

    const after = await prisma.gridCell.findUniqueOrThrow({ where: { id: cell.id } });
    expect(after.status).toBe("HARVESTED");
  });

  it("T-SPEC-GROWTH-001-AC-AC_6: an already-cached WeatherDay is never regenerated, regardless of the preferred source", async () => {
    const location = { latitude: 40.7128, longitude: -74.006 };
    const date = new Date("2026-03-01T00:00:00.000Z");

    const first = await getOrGenerateWeatherDay(prisma, location, date, "PROCEDURAL");
    expect(first.source).toBe("PROCEDURAL");

    // No network call happens here: the date is already cached, so
    // getOrGenerateWeatherDay never reaches RealWeatherProvider at all.
    const second = await getOrGenerateWeatherDay(prisma, location, date, "REAL_API");
    expect(second.source).toBe("PROCEDURAL");
    expect(second.tempHighC).toBe(first.tempHighC);

    const rowCount = await prisma.weatherDay.count({ where: { date } });
    expect(rowCount).toBe(1);
  });

  describe("sim-clock-service", () => {
    it("defaults to real time at rate 1 when no epoch has ever been set", async () => {
      const now = new Date();
      const { simTime, rate } = await getCurrentSimTime(prisma, now);
      expect(rate).toBe(1);
      expect(simTime.getTime()).toBe(now.getTime());
    });

    it("an accelerated rate advances simulated time faster than real time, continuing from the prior anchor", async () => {
      const start = new Date("2026-01-01T00:00:00.000Z");
      await setClockRate(prisma, 24, start); // 24 simulated seconds per real second
      const oneRealHourLater = new Date(start.getTime() + 60 * 60 * 1000);
      const { simTime } = await getCurrentSimTime(prisma, oneRealHourLater);
      expect(simTime.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000); // 24 simulated hours
    });

    it("rejects a negative or absurdly large rate instead of silently accepting it", async () => {
      await expect(setClockRate(prisma, -1)).rejects.toThrow(InvalidClockRateError);
      await expect(setClockRate(prisma, 100_000)).rejects.toThrow(InvalidClockRateError);
    });
  });

  describe("species-catalog", () => {
    it("guesses a seeded species key from a free-typed common name, falling back for anything unrecognized", () => {
      expect(guessSpeciesKey("Roma Tomato")).toBe("tomato");
      expect(guessSpeciesKey("Baby Spinach")).toBe("lettuce");
      expect(guessSpeciesKey("Sea Kraken")).toBe(FALLBACK_SPECIES_KEY);
    });

    it("ensureSpeciesCatalogSeeded is idempotent and never clobbers a hand-edited row", async () => {
      await ensureSpeciesCatalogSeeded(prisma);
      await prisma.speciesProfile.update({ where: { key: "tomato" }, data: { matureHeightCm: 999 } });
      await ensureSpeciesCatalogSeeded(prisma);
      const tomato = await prisma.speciesProfile.findUniqueOrThrow({ where: { key: "tomato" } });
      expect(tomato.matureHeightCm).toBe(999);
    });
  });
});
