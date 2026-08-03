import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient, resetGrowthTables } from "./test-db";
import { resetGridTables } from "../grid/test-db";
import { catchUpGrowth } from "./catch-up-service";
import { FORECAST_WINDOW_DAYS } from "@/domain/weather/weather-service";

// Covers catchUpGrowth's forecast-window pregeneration (pregenerateForecastDays)
// — the only place beyond `through` itself that a WeatherDay row may be
// created, per weather-service.ts's getForecastView read-only contract.

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

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcDay(date: Date): Date {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

describe("catchUpGrowth forecast pregeneration", () => {
  it("generates WeatherDay rows for today through today + FORECAST_WINDOW_DAYS - 1", async () => {
    const through = new Date("2026-03-10T00:00:00.000Z");

    await catchUpGrowth(prisma, { through });

    const rows = await prisma.weatherDay.findMany({ orderBy: { date: "asc" } });
    const isoDates = rows.map((row) => row.date.toISOString().slice(0, 10));
    const expectedIsoDates = Array.from({ length: FORECAST_WINDOW_DAYS }, (_, i) =>
      addUtcDays(startOfUtcDay(through), i).toISOString().slice(0, 10),
    );
    expect(isoDates).toEqual(expectedIsoDates);
  });

  it("does not create additional rows on a second call for the same day", async () => {
    const through = new Date("2026-03-11T00:00:00.000Z");
    await catchUpGrowth(prisma, { through });
    const countAfterFirst = await prisma.weatherDay.count();

    await catchUpGrowth(prisma, { through });
    const countAfterSecond = await prisma.weatherDay.count();

    expect(countAfterSecond).toBe(countAfterFirst);
  });
});
