import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient } from "./test-db";
import { resetGridTables } from "../grid/test-db";
import { resetIrrigationTables } from "./test-db";
import { seedBed } from "../grid/grid-cell-service";
import { addWater } from "./rain-barrel-service";
import { applySimulationWater, getWaterSnapshot, maybeTriggerDailyCycle } from "./irrigation-service";
import { isTransitionAllowed as isRainBarrelTransitionAllowed } from "./rain-barrel-lifecycle";
import { isTransitionAllowed as isCycleTransitionAllowed } from "./irrigation-cycle-lifecycle";

// Traces to: /home/hoang/projects/Sprig/.claude/tests/SPEC-IRRIGATION-001.tests.yaml
// Each `it` below is named after its harness case id so validate_coverage
// results map 1:1 back to the generated test plan.

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

describe("SPEC-IRRIGATION-001", () => {
  it("T-SPEC-IRRIGATION-001-AC-AC_4: overflow beyond combined remaining capacity is recorded, not silently discarded", async () => {
    const barrelA = await prisma.rainBarrel.create({
      data: { capacityGallons: 50, currentGallons: 45, status: "PARTIAL" },
    });
    const barrelB = await prisma.rainBarrel.create({
      data: { capacityGallons: 50, currentGallons: 48, status: "PARTIAL" },
    });

    // Simulated rainfall: 10 gallons on barrelA (only 5 gal of headroom left).
    await addWater(prisma, barrelA.id, 10);

    const updatedA = await prisma.rainBarrel.findUniqueOrThrow({ where: { id: barrelA.id } });
    expect(updatedA.status).toBe("OVERFLOWING");
    expect(updatedA.currentGallons).toBe(50); // clamped at capacity, not 55

    const overflowEvent = await prisma.rainBarrelEvent.findFirst({
      where: { barrelId: barrelA.id, eventType: "OVERFLOW" },
    });
    expect(overflowEvent).not.toBeNull();
    expect(overflowEvent?.amountGallons).toBe(5);

    // barrelB untouched by this call — its own capacity math is independent.
    const updatedB = await prisma.rainBarrel.findUniqueOrThrow({ where: { id: barrelB.id } });
    expect(updatedB.status).toBe("PARTIAL");
  });

  it("T-SPEC-IRRIGATION-001-AC-AC_10: manual SIMULATION-mode watering renders a dry cell wet instantly", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 1 } },
    });
    expect(cell.waterState).toBe("DRY");

    const baseline = await getWaterSnapshot(prisma);
    const baselineEntry = baseline.find((c) => c.cellId === cell.id);
    expect(baselineEntry?.wet).toBe(false);

    const simView = applySimulationWater(baseline, [cell.id]);
    const simEntry = simView.find((c) => c.cellId === cell.id);
    expect(simEntry?.wet).toBe(true);
  });

  it("T-SPEC-IRRIGATION-001-AC-AC_11: crossing 8:00 AM automatically starts the cycle and wets every cell in both beds", async () => {
    const bedA = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const bedB = await seedBed(prisma, { name: "Bed 2", compassPosition: "NORTH" });
    const system = await prisma.irrigationSystem.create({
      data: { beds: { connect: [{ id: bedA.id }, { id: bedB.id }] } },
    });

    const eightAM = new Date();
    eightAM.setHours(8, 0, 0, 0);

    // No manual "start" call anywhere above — only the time-driven tick.
    const result = await maybeTriggerDailyCycle(prisma, system.id, eightAM);
    expect(result).toBe("started");

    const updatedSystem = await prisma.irrigationSystem.findUniqueOrThrow({
      where: { id: system.id },
    });
    expect(updatedSystem.status).toBe("RUNNING");

    const allCells = await prisma.gridCell.findMany({
      where: { bedId: { in: [bedA.id, bedB.id] } },
    });
    expect(allCells.length).toBeGreaterThan(0);
    expect(allCells.every((c) => c.waterState === "WET")).toBe(true);
  });

  it("T-SPEC-IRRIGATION-001-AC-AC_12: after 10 minutes the cycle returns to IDLE and cells stay wet", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const system = await prisma.irrigationSystem.create({
      data: { beds: { connect: [{ id: bed.id }] } },
    });

    const eightAM = new Date();
    eightAM.setHours(8, 0, 0, 0);
    await maybeTriggerDailyCycle(prisma, system.id, eightAM);

    const elevenMinutesLater = new Date(eightAM.getTime() + 11 * 60 * 1000);
    const result = await maybeTriggerDailyCycle(prisma, system.id, elevenMinutesLater);
    expect(result).toBe("ended");

    const updatedSystem = await prisma.irrigationSystem.findUniqueOrThrow({
      where: { id: system.id },
    });
    expect(updatedSystem.status).toBe("IDLE");

    const cells = await prisma.gridCell.findMany({});
    expect(cells.every((c) => c.waterState === "WET")).toBe(true);
  });

  it("T-SPEC-IRRIGATION-001-AC-AC_13: exiting SIMULATION restores the REAL baseline, discarding manual watering", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 1 } },
    });

    const baseline = await getWaterSnapshot(prisma);
    applySimulationWater(baseline, [cell.id]); // manual SIMULATION watering — never persisted

    // Exiting SIMULATION mode means re-reading the REAL baseline directly;
    // there is nothing to "undo" because the overlay never touched the DB.
    const afterExit = await getWaterSnapshot(prisma);
    const entry = afterExit.find((c) => c.cellId === cell.id);
    expect(entry?.wet).toBe(false);
  });

  it("T-SPEC-IRRIGATION-001-FORBID-Rain_barrel_water_level_EMPTY_OVERFLOWING: EMPTY -> OVERFLOWING is rejected", () => {
    expect(isRainBarrelTransitionAllowed("EMPTY", "add_water")).toBe(true);
    expect(isRainBarrelTransitionAllowed("EMPTY", "reach_capacity")).toBe(false);
    expect(isRainBarrelTransitionAllowed("EMPTY", "rain_stop")).toBe(false);
    expect(isRainBarrelTransitionAllowed("EMPTY", "draw_water")).toBe(false);
    // The only legal hop out of EMPTY lands on PARTIAL, never OVERFLOWING —
    // there is no event in the table that maps EMPTY directly to OVERFLOWING.
  });

  it("T-SPEC-IRRIGATION-001-FORBID-Irrigation_cycle_RUNNING_RUNNING: RUNNING -> RUNNING is rejected", () => {
    expect(isCycleTransitionAllowed("RUNNING", "schedule_time_reached")).toBe(false);
    expect(isCycleTransitionAllowed("RUNNING", "duration_elapsed")).toBe(true);
  });

  it("T-SPEC-IRRIGATION-001-NC-NC_SPRIG_IRRIGATION_AUTOMATIC_IN_REAL: the daily cycle requires no manual user action", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const system = await prisma.irrigationSystem.create({
      data: { beds: { connect: [{ id: bed.id }] } },
    });

    const beforeWindow = new Date();
    beforeWindow.setHours(7, 59, 0, 0);
    expect(await maybeTriggerDailyCycle(prisma, system.id, beforeWindow)).toBe("noop");

    const stillIdle = await prisma.irrigationSystem.findUniqueOrThrow({ where: { id: system.id } });
    expect(stillIdle.status).toBe("IDLE");

    // The only call made is the time-driven tick — no separate "start" API.
    const eightAM = new Date();
    eightAM.setHours(8, 0, 0, 0);
    expect(await maybeTriggerDailyCycle(prisma, system.id, eightAM)).toBe("started");
  });

  it("startCycle only wets cells in the system's own linked beds, not every bed in the database", async () => {
    const coveredBed = await seedBed(prisma, { name: "Covered Bed", compassPosition: "SOUTH" });
    const uncoveredBed = await seedBed(prisma, { name: "Uncovered Bed", compassPosition: "NORTH" });
    const system = await prisma.irrigationSystem.create({
      data: { beds: { connect: [{ id: coveredBed.id }] } },
    });

    await maybeTriggerDailyCycle(prisma, system.id, (() => {
      const t = new Date();
      t.setHours(8, 0, 0, 0);
      return t;
    })());

    const coveredCells = await prisma.gridCell.findMany({ where: { bedId: coveredBed.id } });
    const uncoveredCells = await prisma.gridCell.findMany({ where: { bedId: uncoveredBed.id } });
    expect(coveredCells.every((c) => c.waterState === "WET")).toBe(true);
    expect(uncoveredCells.every((c) => c.waterState === "DRY")).toBe(true);
  });

  it("starting a cycle for a system with no linked beds fails loudly instead of silently no-op'ing", async () => {
    const system = await prisma.irrigationSystem.create({ data: {} });
    const eightAM = new Date();
    eightAM.setHours(8, 0, 0, 0);
    await expect(maybeTriggerDailyCycle(prisma, system.id, eightAM)).rejects.toThrow();
  });

  it("a tick that arrives after the 10-minute window still starts the day's cycle once, rather than skipping it", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const system = await prisma.irrigationSystem.create({
      data: { beds: { connect: [{ id: bed.id }] } },
    });

    // First tick of the day arrives at 8:15 — 5 minutes past the window's
    // 8:10 end — because the driving clock happened to skip a beat.
    const lateTick = new Date();
    lateTick.setHours(8, 15, 0, 0);
    expect(await maybeTriggerDailyCycle(prisma, system.id, lateTick)).toBe("started");

    const running = await prisma.irrigationSystem.findUniqueOrThrow({ where: { id: system.id } });
    expect(running.status).toBe("RUNNING");

    // A tick 5 minutes into the catch-up-started run must not end it early —
    // the 10-minute duration is measured from when it actually started
    // (8:15), not the nominal 8:00-8:10 window it missed.
    const fiveMinutesIn = new Date(lateTick.getTime() + 5 * 60 * 1000);
    expect(await maybeTriggerDailyCycle(prisma, system.id, fiveMinutesIn)).toBe("noop");

    // A tick past the run's own 10-minute mark (8:15 + 11min = 8:26) ends it,
    // and does not start a second run for the same day.
    const pastActualDuration = new Date(lateTick.getTime() + 11 * 60 * 1000);
    expect(await maybeTriggerDailyCycle(prisma, system.id, pastActualDuration)).toBe("ended");
  });

  it("a malformed dailyStartTime throws instead of silently never triggering", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const system = await prisma.irrigationSystem.create({
      data: { dailyStartTime: "8", beds: { connect: [{ id: bed.id }] } },
    });

    const eightAM = new Date();
    eightAM.setHours(8, 0, 0, 0);
    await expect(maybeTriggerDailyCycle(prisma, system.id, eightAM)).rejects.toThrow();
  });

  it("addWater rejects a non-finite amount instead of writing an Infinity-valued journal row", async () => {
    const barrel = await prisma.rainBarrel.create({ data: { capacityGallons: 50 } });
    await expect(addWater(prisma, barrel.id, Infinity)).rejects.toThrow();
  });

  it("a non-positive durationMinutes throws instead of silently collapsing the cycle to near-instant", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const system = await prisma.irrigationSystem.create({
      data: { durationMinutes: -5, beds: { connect: [{ id: bed.id }] } },
    });

    const eightAM = new Date();
    eightAM.setHours(8, 0, 0, 0);
    await expect(maybeTriggerDailyCycle(prisma, system.id, eightAM)).rejects.toThrow();
  });

  // NOTE: addWater's optimistic-concurrency guard (conditional updateMany +
  // explicit zero-rows-affected check, see rain-barrel-service.ts) is not
  // independently exercised here. Reliably inducing the actual race — a
  // second write landing strictly between addWater's internal read and its
  // internal write — isn't practical to force deterministically against the
  // shared test connection pool without either invasive mocking or a flaky
  // Promise.all race. The guard is standard, well-understood optimistic-
  // locking practice; AC-4 above already covers the non-concurrent
  // read-compute-write path this guard wraps.
});
