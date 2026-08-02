import type { PrismaClient } from "@prisma/client";
import {
  InvalidDailyStartTimeError,
  InvalidDurationMinutesError,
  IrrigationCycleTransitionError,
  IrrigationSystemNotLinkedToAnyBedError,
} from "./errors";
import { nextStatus } from "./irrigation-cycle-lifecycle";

export interface CellWaterView {
  cellId: string;
  wet: boolean;
}

// Starts the daily cycle: IDLE -> RUNNING, opens an IrrigationRun row, and
// wets every cell in the beds this system actually covers — "waters all
// cells in both beds equally" (SPEC-IRRIGATION-001 shared_schemas
// IrrigationSystem.bed_ids), scoped by the system<->Bed relation rather than
// every GridCell in the database. A system with no linked beds is a
// configuration error, not a silent no-op — it fails loudly instead of
// quietly "watering nothing" and reporting success. Instant, not gradual:
// soil moisture decay over time is explicitly out of scope.
export async function startCycle(
  prisma: PrismaClient,
  systemId: string,
  startedAt: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const system = await tx.irrigationSystem.findUniqueOrThrow({
      where: { id: systemId },
      include: { beds: { select: { id: true } } },
    });
    if (system.beds.length === 0) {
      throw new IrrigationSystemNotLinkedToAnyBedError(
        `IrrigationSystem ${systemId} has no linked beds; link it to the beds it waters before starting a cycle.`,
      );
    }
    const newStatus = nextStatus(system.status, "schedule_time_reached");

    await tx.irrigationRun.create({ data: { systemId, startedAt } });
    await tx.irrigationSystem.update({ where: { id: systemId }, data: { status: newStatus } });
    await tx.gridCell.updateMany({
      where: { bedId: { in: system.beds.map((bed) => bed.id) } },
      data: { waterState: "WET" },
    });
  });
}

// Ends the daily cycle: RUNNING -> IDLE, closes the open IrrigationRun.
// Deliberately does not touch GridCell.waterState — AC-12 requires cells to
// remain wet after the cycle ends, per the no-decay water model.
export async function endCycle(
  prisma: PrismaClient,
  systemId: string,
  endedAt: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const system = await tx.irrigationSystem.findUniqueOrThrow({ where: { id: systemId } });
    const newStatus = nextStatus(system.status, "duration_elapsed");

    const openRun = await tx.irrigationRun.findFirst({
      where: { systemId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });
    if (openRun) {
      await tx.irrigationRun.update({ where: { id: openRun.id }, data: { endedAt } });
    }
    await tx.irrigationSystem.update({ where: { id: systemId }, data: { status: newStatus } });
  });
}

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

// A malformed dailyStartTime (a typo like "8" instead of "08:00", an empty
// string, an out-of-range hour) must not silently no-op the automatic
// trigger forever — that would defeat NC-SPRIG-IRRIGATION-AUTOMATIC-IN-REAL
// just as thoroughly as skipping the window on purpose, only quieter.
function parseDailyStartTime(dailyStartTime: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(dailyStartTime);
  if (!match) {
    throw new InvalidDailyStartTimeError(
      `IrrigationSystem.dailyStartTime "${dailyStartTime}" is not a valid 24-hour "HH:MM" time.`,
    );
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

// Same failure class as dailyStartTime: a non-positive durationMinutes
// (misconfiguration, not a schema violation — the column only guarantees
// an Int) would make windowEnd <= windowStart, silently collapsing the
// "runs for its fixed duration" cycle to near-instant.
function assertValidDurationMinutes(durationMinutes: number): void {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new InvalidDurationMinutesError(
      `IrrigationSystem.durationMinutes (${durationMinutes}) must be a positive integer.`,
    );
  }
}

// The automatic driver behind NC-SPRIG-IRRIGATION-AUTOMATIC-IN-REAL: a
// caller (the REAL-mode viewer's clock tick, in a future spec) invokes this
// on every tick with the current simulated/real time. No separate "start"
// or "stop" UI action exists — crossing the daily window is what drives the
// IDLE/RUNNING transition, mirroring how sunrise/sunset drives the light
// system.
//
// Starting is gated on "no run recorded yet today", not on `now` still
// being inside the nominal window: a tick cadence coarser than the window
// (a skipped tick, a large simulated-time jump) must not cause the whole
// day's watering to be silently skipped forever. Ending is gated on the
// duration having elapsed since the run's *actual* startedAt, not the
// nominal daily window — a catch-up-started run must still get its full
// durationMinutes, not be judged against the window it missed.
//
// This function's own read of `system.status` happens outside a
// transaction, so two ticks firing close together can both read the same
// pre-transition status and both attempt the same hop. The loser of that
// race gets IrrigationCycleTransitionError from startCycle/endCycle's own
// (correctly transactional) re-check — which here means "someone else's
// tick already made this transition," not a real failure, so it resolves
// to "noop" rather than propagating to whatever's driving the clock.
export async function maybeTriggerDailyCycle(
  prisma: PrismaClient,
  systemId: string,
  now: Date,
): Promise<"started" | "ended" | "noop"> {
  const system = await prisma.irrigationSystem.findUniqueOrThrow({ where: { id: systemId } });
  assertValidDurationMinutes(system.durationMinutes);

  if (system.status === "RUNNING") {
    const openRun = await prisma.irrigationRun.findFirst({
      where: { systemId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });
    const actualWindowEnd = openRun
      ? new Date(openRun.startedAt.getTime() + system.durationMinutes * 60 * 1000)
      : now; // no open run on record — nothing to wait out; end immediately.
    if (now >= actualWindowEnd) {
      try {
        await endCycle(prisma, systemId, now);
        return "ended";
      } catch (error) {
        if (error instanceof IrrigationCycleTransitionError) {
          return "noop";
        }
        throw error;
      }
    }
    return "noop";
  }

  // status === "IDLE"
  const { hour: startHour, minute: startMinute } = parseDailyStartTime(system.dailyStartTime);
  const windowStart = new Date(now);
  windowStart.setHours(startHour, startMinute, 0, 0);

  if (now >= windowStart) {
    const todaysRun = await prisma.irrigationRun.findFirst({
      where: { systemId, startedAt: { gte: startOfDay(now) } },
    });
    if (!todaysRun) {
      try {
        await startCycle(prisma, systemId, now);
        return "started";
      } catch (error) {
        if (error instanceof IrrigationCycleTransitionError) {
          return "noop";
        }
        throw error;
      }
    }
  }
  return "noop";
}

// The REAL baseline read model: one row per grid cell, sourced directly
// from the persisted waterState column (never from a SIMULATION overlay).
export async function getWaterSnapshot(prisma: PrismaClient): Promise<CellWaterView[]> {
  const cells = await prisma.gridCell.findMany({ select: { id: true, waterState: true } });
  return cells.map((cell) => ({ cellId: cell.id, wet: cell.waterState === "WET" }));
}

// SIMULATION-mode manual watering (NC-SPRIG-MANUAL-WATER-NOT-A-SUBSTITUTE):
// a pure, non-persisted overlay over the REAL baseline. Returns a NEW array
// (immutable) marking the given cells wet; never writes to the database.
// Exiting SIMULATION mode requires no cleanup/rollback — the overlay simply
// stops being read, and getWaterSnapshot continues to reflect the REAL
// baseline unchanged (AC-13).
export function applySimulationWater(
  baseline: readonly CellWaterView[],
  wateredCellIds: readonly string[],
): CellWaterView[] {
  const watered = new Set(wateredCellIds);
  return baseline.map((cell) => (watered.has(cell.cellId) ? { ...cell, wet: true } : cell));
}
