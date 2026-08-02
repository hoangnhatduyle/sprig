import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient } from "../grid/test-db";
import { resetGrowthTables } from "../growth/test-db";
import { resetGridTables } from "../grid/test-db";
import { getOrGenerateWeatherDay, getWeatherDayView } from "./weather-service";

// Traces to SPEC-SURFACE-001's NC-SPRIG-SURFACE-READ-ONLY-WEATHER-VIEW: the
// client-facing weather read must never generate or refetch a WeatherDay —
// only getOrGenerateWeatherDay (called from catch-up-service.ts) may do
// that.

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

const LOCATION = { latitude: 40.7128, longitude: -74.006 };

describe("getWeatherDayView", () => {
  it("returns null for a date with no generated WeatherDay row, and does not create one", async () => {
    const date = new Date("2026-03-01T00:00:00.000Z");
    const before = await prisma.weatherDay.count();

    const view = await getWeatherDayView(prisma, date);

    expect(view).toBeNull();
    const after = await prisma.weatherDay.count();
    expect(after).toBe(before);
  });

  it("returns the cached row, with isSnowDay correctly derived, for an already-generated day", async () => {
    const date = new Date("2026-01-15T00:00:00.000Z");
    const generated = await getOrGenerateWeatherDay(prisma, LOCATION, date, "PROCEDURAL");
    // Force a sub-zero + precipitation day directly, independent of
    // whatever the procedural generator happened to roll, so isSnowDay's
    // derivation is unambiguously exercised (cross-checks snow.test.ts's
    // own predicate coverage against this read model).
    await prisma.weatherDay.update({
      where: { id: generated.id },
      data: { tempLowC: -3, precipitationMm: 4 },
    });

    const view = await getWeatherDayView(prisma, date);

    expect(view).not.toBeNull();
    expect(view!.isSnowDay).toBe(true);
    expect(view!.tempLowC).toBe(-3);
    expect(view!.precipitationMm).toBe(4);
  });

  it("normalizes the queried date to UTC midnight, matching getOrGenerateWeatherDay's own cache key", async () => {
    const date = new Date("2026-02-10T00:00:00.000Z");
    await getOrGenerateWeatherDay(prisma, LOCATION, date, "PROCEDURAL");

    const view = await getWeatherDayView(prisma, new Date("2026-02-10T15:30:00.000Z"));

    expect(view).not.toBeNull();
  });
});
