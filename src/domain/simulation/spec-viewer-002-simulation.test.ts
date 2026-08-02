import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient } from "./test-db";
import { resetGridTables } from "../grid/test-db";
import { resetSimulationTables } from "./test-db";
import { seedBed } from "../grid/grid-cell-service";
import { getWaterSnapshot } from "../irrigation/irrigation-service";
import { SimulationRunTransitionError } from "./simulation-run-lifecycle";
import {
  configureRun,
  createDraftRun,
  finishRun,
  startRun,
  updateRunScenario,
} from "./simulation-service";

// Traces to: /home/hoang/projects/Sprig/.claude/tests/SPEC-VIEWER-002.tests.yaml
//
// RED gate: updateRunScenario does not exist yet on simulation-service.ts —
// configureRun's "set_scenario" FSM event is only legal from DRAFT
// (simulation-run-lifecycle.ts), so it cannot be called again once a run is
// RUNNING. Every test below is expected to fail on import resolution until
// updateRunScenario (a scenario-column update that does NOT drive the
// status FSM) is implemented.

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetSimulationTables(prisma);
  await resetGridTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

afterAll(async () => {
  const cleanup = createTestPrismaClient();
  await resetSimulationTables(cleanup);
  await resetGridTables(cleanup);
  await cleanup.$disconnect();
});

describe("SPEC-VIEWER-002", () => {
  it("T-SPEC-VIEWER-002-AC-AC_2: live watering + a scrubbed simulated time persist into the SimulationRun row as the user interacts", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const cellA = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 1 } },
    });
    const cellB = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 2, row: 1 } },
    });

    const run = await createDraftRun(prisma);
    // configureRun at start time captures only the empty defaults — this is
    // the gap SPEC-VIEWER-002 closes: the UI never called it again as the
    // scenario changed.
    await configureRun(prisma, run.id, { waterInput: {}, simulatedTime: null });
    await startRun(prisma, run.id);

    // First interaction: the user waters cell A.
    await updateRunScenario(prisma, run.id, {
      waterInput: { [cellA.id]: 1 },
      simulatedTime: new Date("2026-07-28T14:00:00.000Z"),
    });

    // Second interaction: the user also waters cell B and scrubs the slider
    // further — a later call must reflect BOTH cells, not just the latest.
    await updateRunScenario(prisma, run.id, {
      waterInput: { [cellA.id]: 1, [cellB.id]: 1 },
      simulatedTime: new Date("2026-07-28T18:00:00.000Z"),
    });

    const persisted = await prisma.simulationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(JSON.parse(persisted.waterInput ?? "{}")).toEqual({ [cellA.id]: 1, [cellB.id]: 1 });
    expect(JSON.parse(persisted.affectedCells ?? "[]").sort()).toEqual(
      [cellA.id, cellB.id].sort(),
    );
    expect(persisted.simulatedTime).toEqual(new Date("2026-07-28T18:00:00.000Z"));
    // Still RUNNING — updateRunScenario must not itself drive the status FSM.
    expect(persisted.status).toBe("RUNNING");
  });

  it("T-SPEC-VIEWER-002-NC-NC_SPRIG_VIEWER2_NO_OVERWRITE_JOURNAL: repeated live scenario updates never write GridCell/GridCellEvent", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 1 } },
    });

    const beforeWaterSnapshot = await getWaterSnapshot(prisma);
    const beforeEventCount = await prisma.gridCellEvent.count();
    const beforeCellRow = await prisma.gridCell.findUniqueOrThrow({ where: { id: cell.id } });

    const run = await createDraftRun(prisma);
    await configureRun(prisma, run.id, { waterInput: {}, simulatedTime: null });
    await startRun(prisma, run.id);

    // Simulate several live interactions in one session (watering, scrubbing
    // time, watering again) — each is its own updateRunScenario call, mirroring
    // how the viewer will call this as the user acts, not just once at exit.
    await updateRunScenario(prisma, run.id, {
      waterInput: { [cell.id]: 1 },
      simulatedTime: new Date("2026-07-28T09:00:00.000Z"),
    });
    await updateRunScenario(prisma, run.id, {
      waterInput: { [cell.id]: 1 },
      simulatedTime: new Date("2026-07-28T12:00:00.000Z"),
    });
    await updateRunScenario(prisma, run.id, {
      waterInput: { [cell.id]: 1 },
      simulatedTime: new Date("2026-07-28T20:00:00.000Z"),
    });
    await finishRun(prisma, run.id);

    const afterEventCount = await prisma.gridCellEvent.count();
    expect(afterEventCount).toBe(beforeEventCount);

    const afterCellRow = await prisma.gridCell.findUniqueOrThrow({ where: { id: cell.id } });
    expect(afterCellRow.waterState).toBe(beforeCellRow.waterState);
    expect(afterCellRow.status).toBe(beforeCellRow.status);
    expect(afterCellRow.plantedAt).toEqual(beforeCellRow.plantedAt);

    const afterWaterSnapshot = await getWaterSnapshot(prisma);
    expect(afterWaterSnapshot).toEqual(beforeWaterSnapshot);

    // updateRunScenario also inherits configureRun's dangling-reference
    // guard — persisting a waterInput keyed by an unknown GridCell id must
    // fail loudly rather than writing a reference no later read can resolve.
    const secondRun = await createDraftRun(prisma);
    await configureRun(prisma, secondRun.id, { waterInput: {}, simulatedTime: null });
    await startRun(prisma, secondRun.id);
    await expect(
      updateRunScenario(prisma, secondRun.id, {
        waterInput: { "nonexistent-cell": 1 },
        simulatedTime: null,
      }),
    ).rejects.toThrow();

    // And it must refuse to act on a run that isn't RUNNING/PAUSED (DRAFT or
    // COMPLETED) — silently "succeeding" there would let a finished run's
    // record of what it simulated be rewritten after the fact.
    const draftRun = await createDraftRun(prisma);
    await expect(
      updateRunScenario(prisma, draftRun.id, { waterInput: {}, simulatedTime: null }),
    ).rejects.toThrow(SimulationRunTransitionError);

    const completedRun = await createDraftRun(prisma);
    await configureRun(prisma, completedRun.id, { waterInput: {}, simulatedTime: null });
    await startRun(prisma, completedRun.id);
    await finishRun(prisma, completedRun.id);
    await expect(
      updateRunScenario(prisma, completedRun.id, { waterInput: {}, simulatedTime: null }),
    ).rejects.toThrow(SimulationRunTransitionError);
  });
});
