import { Prisma, type PrismaClient, type SimulationRun } from "@prisma/client";
import { InvalidSimulationWaterAmountError, UnknownSimulationCellError } from "./errors";
import {
  type SimulationRunEvent,
  type SimulationRunStatus,
  SimulationRunTransitionError,
  nextStatus,
} from "./simulation-run-lifecycle";

// A "change a condition and observe" scenario: how much hypothetical water
// lands on which cells, and at what simulated instant the scene is being
// observed. Both are inputs to the *overlay* the 3D viewer renders on top of
// the REAL baseline (applySimulationWater / computeCellLightExposure) — never
// to a write against GridCell/GridCellEvent (NC-SPRIG-NO-OVERWRITE-JOURNAL).
export interface SimulationScenario {
  waterInput: Record<string, number>;
  simulatedTime: Date | null;
}

// A run left RUNNING/PAUSED because the tab crashed, was hard-refreshed, or
// lost network — none of which fire a client-side unmount/navigation
// handler — would otherwise sit there forever with nothing left to ever
// finish it. A bulk sweep keyed on age is a stronger guarantee than chasing
// every possible browser unload event client-side: it self-heals regardless
// of *how* the client disappeared, run opportunistically whenever a new
// simulation starts (the one moment a stale leftover is guaranteed to be
// noticed, without needing a background job or cron for a low-risk preview
// feature). Direct bulk update, not the single-row `advance` transition
// helper below: this is reclaiming abandoned state, not a normal user-driven
// FSM hop, so it deliberately doesn't go through per-row transition
// validation.
const STALE_RUN_THRESHOLD_MS = 30 * 60 * 1000;

async function reapStaleRuns(prisma: PrismaClient): Promise<void> {
  await prisma.simulationRun.updateMany({
    where: {
      status: { in: ["RUNNING", "PAUSED"] },
      updatedAt: { lt: new Date(Date.now() - STALE_RUN_THRESHOLD_MS) },
    },
    data: { status: "COMPLETED" },
  });
}

export async function createDraftRun(prisma: PrismaClient): Promise<SimulationRun> {
  await reapStaleRuns(prisma);
  return prisma.simulationRun.create({ data: { status: "DRAFT" } });
}

function assertValidWaterInput(waterInput: Record<string, number>): void {
  for (const [cellId, amount] of Object.entries(waterInput)) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new InvalidSimulationWaterAmountError(
        `Simulated water amount for cell ${cellId} (${amount}) must be a positive, finite number.`,
      );
    }
  }
}

// Shared by configureRun and updateRunScenario: a waterInput keyed by a
// GridCell id that doesn't exist would otherwise be written as a dangling
// reference that no later overlay read could resolve — silently simulating
// nothing while reporting success.
//
// The existence check is explicit rather than schema-enforced for the same
// reason as src/domain/grid/grid-cell-service.ts's: this datasource's driver
// adapter doesn't reliably validate foreign keys, and these ids live inside a
// JSON blob, which has no foreign key to validate in the first place.
async function assertKnownCells(
  tx: Pick<Prisma.TransactionClient, "gridCell">,
  cellIds: readonly string[],
): Promise<void> {
  if (cellIds.length === 0) {
    return;
  }
  const known = await tx.gridCell.findMany({
    where: { id: { in: [...cellIds] } },
    select: { id: true },
  });
  const knownIds = new Set(known.map((cell) => cell.id));
  const missing = cellIds.filter((id) => !knownIds.has(id));
  if (missing.length > 0) {
    throw new UnknownSimulationCellError(
      `Simulation scenario references unknown GridCell id(s): ${missing.join(", ")}.`,
    );
  }
}

// DRAFT -> CONFIGURED. Validates the scenario against the REAL grid before
// persisting it (see assertKnownCells).
export async function configureRun(
  prisma: PrismaClient,
  runId: string,
  scenario: SimulationScenario,
): Promise<SimulationRun> {
  assertValidWaterInput(scenario.waterInput);
  const cellIds = Object.keys(scenario.waterInput);

  return prisma.$transaction(async (tx) => {
    const run = await tx.simulationRun.findUniqueOrThrow({ where: { id: runId } });
    const newStatus = nextStatus(run.status as SimulationRunStatus, "set_scenario");
    await assertKnownCells(tx, cellIds);

    return tx.simulationRun.update({
      where: { id: run.id },
      data: {
        status: newStatus,
        waterInput: JSON.stringify(scenario.waterInput),
        simulatedTime: scenario.simulatedTime,
        affectedCells: JSON.stringify(cellIds),
      },
    });
  });
}

// Re-persists the SAME run's scenario columns as the user keeps interacting
// with an already-RUNNING/PAUSED simulation (waters another cell, scrubs the
// time slider) — distinct from configureRun, which only ever runs once, at
// DRAFT -> CONFIGURED, because "set_scenario" is not a legal FSM event from
// any other status (simulation-run-lifecycle.ts's TRANSITIONS table). This
// function deliberately does NOT drive that FSM: the run's status is
// untouched, only waterInput/simulatedTime/affectedCells are overwritten with
// the latest scenario, closing the gap where only the empty defaults
// captured at configureRun time were ever persisted.
//
// Restricted to RUNNING/PAUSED (not DRAFT or COMPLETED): a DRAFT run has no
// scenario to "update" yet (that's what configureRun is for), and a
// COMPLETED run's record of what it actually simulated must stay fixed —
// silently rewriting it after the fact would falsify the historical row.
export async function updateRunScenario(
  prisma: PrismaClient,
  runId: string,
  scenario: SimulationScenario,
): Promise<SimulationRun> {
  assertValidWaterInput(scenario.waterInput);
  const cellIds = Object.keys(scenario.waterInput);

  return prisma.$transaction(async (tx) => {
    const run = await tx.simulationRun.findUniqueOrThrow({ where: { id: runId } });
    const status = run.status as SimulationRunStatus;
    if (status !== "RUNNING" && status !== "PAUSED") {
      throw new SimulationRunTransitionError(
        `Cannot update the live scenario for a run in status ${status}; it must be RUNNING or PAUSED.`,
      );
    }
    await assertKnownCells(tx, cellIds);

    return tx.simulationRun.update({
      where: { id: run.id },
      data: {
        waterInput: JSON.stringify(scenario.waterInput),
        simulatedTime: scenario.simulatedTime,
        affectedCells: JSON.stringify(cellIds),
      },
    });
  });
}

// Shared implementation behind start/pause/resume/finish: re-read the
// persisted status inside the transaction and advance it by exactly one
// event, so two concurrent callers can't both act on the same stale status.
// The scenario columns are never touched here — a run's record of what it
// simulated stays exactly as configured, through to COMPLETED.
async function advance(
  prisma: PrismaClient,
  runId: string,
  event: SimulationRunEvent,
): Promise<SimulationRun> {
  return prisma.$transaction(async (tx) => {
    const run = await tx.simulationRun.findUniqueOrThrow({ where: { id: runId } });
    // Throws SimulationRunTransitionError for an out-of-order call (starting
    // a still-DRAFT run, resuming a COMPLETED one).
    const newStatus = nextStatus(run.status as SimulationRunStatus, event);
    return tx.simulationRun.update({ where: { id: run.id }, data: { status: newStatus } });
  });
}

export function startRun(prisma: PrismaClient, runId: string): Promise<SimulationRun> {
  return advance(prisma, runId, "start");
}

export function pauseRun(prisma: PrismaClient, runId: string): Promise<SimulationRun> {
  return advance(prisma, runId, "pause");
}

export function resumeRun(prisma: PrismaClient, runId: string): Promise<SimulationRun> {
  return advance(prisma, runId, "resume");
}

export function finishRun(prisma: PrismaClient, runId: string): Promise<SimulationRun> {
  return advance(prisma, runId, "finish");
}

