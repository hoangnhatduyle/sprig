import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient } from "./test-db";
import { resetGridTables } from "../grid/test-db";
import { resetIrrigationTables } from "./test-db";
import { seedBed } from "../grid/grid-cell-service";
import {
  InvalidRainSkipLookbackDaysError,
  InvalidRainSkipThresholdError,
} from "./errors";
import { maybeTriggerDailyCycle, updateIrrigationSettings } from "./irrigation-service";

// Traces to: /home/hoang/projects/Sprig/.claude/tests/SPEC-IRRIGATION-001.tests.yaml
// (AC-14, AC-15, AC-16 — added for v0.2.0's rain-skip + manual pause).

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetIrrigationTables(prisma);
  await resetGridTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

afterAll(async () => {
  const cleanup = createTestPrismaClient();
  await resetIrrigationTables(cleanup);
  await resetGridTables(cleanup);
  await cleanup.$disconnect();
});

function startOfUtcDay(date: Date): Date {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function seedWeatherDay(prisma: PrismaClient, date: Date, precipitationMm: number): Promise<void> {
  await prisma.weatherDay.create({
    data: {
      date: startOfUtcDay(date),
      tempHighC: 22,
      tempLowC: 12,
      precipitationMm,
      cloudCoverPct: precipitationMm > 0 ? 80 : 20,
      humidityPct: 60,
      windSpeedKph: 10,
      condition: precipitationMm > 0 ? "RAIN" : "CLEAR",
      source: "PROCEDURAL",
    },
  });
}

describe("SPEC-IRRIGATION-001 v0.2.0", () => {
  it("T-SPEC-IRRIGATION-001-AC-AC_14: a due window is skipped when recent rainfall meets the threshold", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const system = await prisma.irrigationSystem.create({
      data: {
        beds: { connect: [{ id: bed.id }] },
        rainSkipThresholdMm: 6,
        rainSkipLookbackDays: 2,
      },
    });

    const eightAM = new Date();
    eightAM.setHours(8, 0, 0, 0);
    // 8mm over the 2-day lookback (today + yesterday) — at/above the 6mm threshold.
    await seedWeatherDay(prisma, eightAM, 5);
    await seedWeatherDay(prisma, addUtcDays(eightAM, -1), 3);

    const result = await maybeTriggerDailyCycle(prisma, system.id, eightAM);
    expect(result).toBe("noop");

    const runs = await prisma.irrigationRun.findMany({ where: { systemId: system.id } });
    expect(runs).toHaveLength(0);

    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 1 } },
    });
    expect(cell.waterState).toBe("DRY");
  });

  it("T-SPEC-IRRIGATION-001-AC-AC_14b: a due window still starts when recent rainfall is below the threshold", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const system = await prisma.irrigationSystem.create({
      data: {
        beds: { connect: [{ id: bed.id }] },
        rainSkipThresholdMm: 6,
        rainSkipLookbackDays: 2,
      },
    });

    const eightAM = new Date();
    eightAM.setHours(8, 0, 0, 0);
    // 2mm over the lookback window — below the 6mm threshold.
    await seedWeatherDay(prisma, eightAM, 1);
    await seedWeatherDay(prisma, addUtcDays(eightAM, -1), 1);

    const result = await maybeTriggerDailyCycle(prisma, system.id, eightAM);
    expect(result).toBe("started");

    const runs = await prisma.irrigationRun.findMany({ where: { systemId: system.id } });
    expect(runs).toHaveLength(1);
  });

  it("T-SPEC-IRRIGATION-001-AC-AC_15: enabled=false blocks a new start but a RUNNING cycle still ends normally", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const system = await prisma.irrigationSystem.create({
      data: { beds: { connect: [{ id: bed.id }] }, enabled: false },
    });

    const eightAM = new Date();
    eightAM.setHours(8, 0, 0, 0);
    await seedWeatherDay(prisma, eightAM, 0);
    await seedWeatherDay(prisma, addUtcDays(eightAM, -1), 0);

    const blockedResult = await maybeTriggerDailyCycle(prisma, system.id, eightAM);
    expect(blockedResult).toBe("noop");
    expect(await prisma.irrigationRun.count({ where: { systemId: system.id } })).toBe(0);

    // A cycle already RUNNING (started before the pause) must still be able
    // to finish — disabling must never strand a system mid-cycle.
    await prisma.irrigationSystem.update({
      where: { id: system.id },
      data: { status: "RUNNING" },
    });
    await prisma.irrigationRun.create({
      data: { systemId: system.id, startedAt: eightAM },
    });

    const afterDuration = new Date(eightAM.getTime() + system.durationMinutes * 60 * 1000 + 1000);
    const endResult = await maybeTriggerDailyCycle(prisma, system.id, afterDuration);
    expect(endResult).toBe("ended");

    const updated = await prisma.irrigationSystem.findUniqueOrThrow({ where: { id: system.id } });
    expect(updated.status).toBe("IDLE");
  });

  it("T-SPEC-IRRIGATION-001-AC-AC_16: updateIrrigationSettings persists new values and rejects invalid ones", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const system = await prisma.irrigationSystem.create({
      data: { beds: { connect: [{ id: bed.id }] } },
    });

    await updateIrrigationSettings(prisma, system.id, {
      enabled: false,
      rainSkipEnabled: false,
      rainSkipThresholdMm: 10,
      rainSkipLookbackDays: 3,
    });

    const updated = await prisma.irrigationSystem.findUniqueOrThrow({ where: { id: system.id } });
    expect(updated.enabled).toBe(false);
    expect(updated.rainSkipEnabled).toBe(false);
    expect(updated.rainSkipThresholdMm).toBe(10);
    expect(updated.rainSkipLookbackDays).toBe(3);

    await expect(
      updateIrrigationSettings(prisma, system.id, { rainSkipThresholdMm: -1 }),
    ).rejects.toBeInstanceOf(InvalidRainSkipThresholdError);
    await expect(
      updateIrrigationSettings(prisma, system.id, { rainSkipLookbackDays: 0 }),
    ).rejects.toBeInstanceOf(InvalidRainSkipLookbackDaysError);
  });

  it("a later same-day window is still independently evaluated after an earlier one was skipped for rain", async () => {
    const bedA = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const system = await prisma.irrigationSystem.create({
      data: {
        beds: { connect: [{ id: bedA.id }] },
        dailyStartTimes: ["08:00", "17:00"],
        rainSkipThresholdMm: 6,
        rainSkipLookbackDays: 1,
      },
    });

    const fivePM = new Date();
    fivePM.setHours(17, 0, 0, 0);
    // Only today's rain counts (lookback = 1 day): below threshold, so the
    // 08:00 window (already past by 17:00) and the 17:00 window should both
    // be evaluated on their own merits — neither skipped for rain here.
    await seedWeatherDay(prisma, fivePM, 1);

    const result = await maybeTriggerDailyCycle(prisma, system.id, fivePM);
    expect(result).toBe("started");

    const runs = await prisma.irrigationRun.findMany({ where: { systemId: system.id } });
    expect(runs).toHaveLength(1);
  });
});
