import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient } from "../grid/test-db";
import { resetGrowthTables } from "../growth/test-db";
import { resetGridTables } from "../grid/test-db";
import { FORECAST_WINDOW_DAYS, getForecastView, getOrGenerateWeatherDay, getWeatherRangeView } from "./weather-service";

// Companion to weather-read-view.test.ts, covering getForecastView's own
// read-only contract (NC-SPRIG-SURFACE-READ-ONLY-WEATHER-VIEW): it must
// never generate or refetch a WeatherDay, only catch-up-service.ts's
// pregenerateForecastDays may do that.

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

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

describe("getForecastView", () => {
  it("returns an empty array when no WeatherDay rows exist for the window", async () => {
    const from = new Date("2026-03-01T00:00:00.000Z");

    const view = await getForecastView(prisma, from);

    expect(view).toEqual([]);
  });

  it("returns the cached rows for the requested window, in date order", async () => {
    const from = new Date("2026-04-01T00:00:00.000Z");
    for (let i = 0; i < FORECAST_WINDOW_DAYS; i++) {
      await getOrGenerateWeatherDay(prisma, LOCATION, addUtcDays(from, i), "PROCEDURAL");
    }

    const view = await getForecastView(prisma, from);

    expect(view).toHaveLength(FORECAST_WINDOW_DAYS);
    const isoDates = view.map((day) => new Date(day.date).toISOString().slice(0, 10));
    const expectedIsoDates = Array.from({ length: FORECAST_WINDOW_DAYS }, (_, i) =>
      addUtcDays(from, i).toISOString().slice(0, 10),
    );
    expect(isoDates).toEqual(expectedIsoDates);
  });

  it("skips a gap day without throwing when only some of the window is cached", async () => {
    const from = new Date("2026-05-01T00:00:00.000Z");
    await getOrGenerateWeatherDay(prisma, LOCATION, from, "PROCEDURAL");
    // Day+1 deliberately left ungenerated.
    await getOrGenerateWeatherDay(prisma, LOCATION, addUtcDays(from, 2), "PROCEDURAL");

    const view = await getForecastView(prisma, from, 3);

    expect(view).toHaveLength(2);
  });

  it("never writes a WeatherDay row itself", async () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    const before = await prisma.weatherDay.count();

    await getForecastView(prisma, from);

    const after = await prisma.weatherDay.count();
    expect(after).toBe(before);
  });

  it("normalizes the start date to UTC midnight, matching getOrGenerateWeatherDay's own cache key", async () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    await getOrGenerateWeatherDay(prisma, LOCATION, from, "PROCEDURAL");

    const view = await getForecastView(prisma, new Date("2026-07-01T18:45:00.000Z"), 1);

    expect(view).toHaveLength(1);
  });
});

// Trends tab's weather chart accessor — same read-only contract as
// getForecastView above, but for an arbitrary backward-looking since/until
// range instead of a fixed forward-looking window.
describe("getWeatherRangeView", () => {
  it("returns an empty array when no WeatherDay rows exist in range", async () => {
    const view = await getWeatherRangeView(
      prisma,
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    );

    expect(view).toEqual([]);
  });

  it("returns cached rows within the range, in ascending date order", async () => {
    const start = new Date("2026-09-01T00:00:00.000Z");
    await getOrGenerateWeatherDay(prisma, LOCATION, addUtcDays(start, 2), "PROCEDURAL");
    await getOrGenerateWeatherDay(prisma, LOCATION, start, "PROCEDURAL");
    await getOrGenerateWeatherDay(prisma, LOCATION, addUtcDays(start, 1), "PROCEDURAL");

    const view = await getWeatherRangeView(prisma, start, addUtcDays(start, 2));

    const isoDates = view.map((day) => new Date(day.date).toISOString().slice(0, 10));
    expect(isoDates).toEqual([
      start.toISOString().slice(0, 10),
      addUtcDays(start, 1).toISOString().slice(0, 10),
      addUtcDays(start, 2).toISOString().slice(0, 10),
    ]);
  });

  it("excludes rows outside the requested range", async () => {
    const start = new Date("2026-10-01T00:00:00.000Z");
    await getOrGenerateWeatherDay(prisma, LOCATION, addUtcDays(start, -1), "PROCEDURAL");
    await getOrGenerateWeatherDay(prisma, LOCATION, start, "PROCEDURAL");
    await getOrGenerateWeatherDay(prisma, LOCATION, addUtcDays(start, 1), "PROCEDURAL");

    const view = await getWeatherRangeView(prisma, start, start);

    expect(view).toHaveLength(1);
  });

  it("never writes a WeatherDay row itself", async () => {
    const start = new Date("2026-11-01T00:00:00.000Z");
    const before = await prisma.weatherDay.count();

    await getWeatherRangeView(prisma, start, addUtcDays(start, 5));

    const after = await prisma.weatherDay.count();
    expect(after).toBe(before);
  });
});
