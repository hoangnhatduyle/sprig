import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient } from "./test-db";
import { resetGridTables } from "../grid/test-db";
import { resetSimulationTables } from "./test-db";
import { seedBed } from "../grid/grid-cell-service";
import { getWaterSnapshot } from "../irrigation/irrigation-service";
import {
  isTransitionAllowed,
  nextStatus,
  SimulationRunTransitionError,
} from "./simulation-run-lifecycle";
import {
  configureRun,
  createDraftRun,
  finishRun,
  pauseRun,
  resumeRun,
  startRun,
} from "./simulation-service";

// Traces to: /home/hoang/projects/Sprig/.claude/tests/SPEC-VIEWER-001.tests.yaml
// Each `it` below is named after its harness case id so validate_coverage
// results map 1:1 back to the generated test plan.
//
// RED gate: simulation-run-lifecycle.ts and simulation-service.ts do not
// exist yet (see prisma/schema.prisma's SimulationRun model, which IS
// already persisted — only the domain layer wrapping it is missing). Every
// test below is expected to fail on import resolution until that domain
// layer is implemented.

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

describe("SPEC-VIEWER-001", () => {
  it("T-SPEC-VIEWER-001-FORBID-Simulation_run_COMPLETED_RUNNING: COMPLETED -> RUNNING is rejected", () => {
    // Mirrors SPEC-VIEWER-001 state_machines "Simulation run": DRAFT ->
    // CONFIGURED -> RUNNING -> PAUSED -> RUNNING -> COMPLETED, with
    // COMPLETED -> RUNNING explicitly forbidden ("A completed simulation
    // run must be re-configured as a new run, not resumed").
    expect(isTransitionAllowed("COMPLETED", "start")).toBe(false);
    expect(isTransitionAllowed("COMPLETED", "resume")).toBe(false);
    expect(() => nextStatus("COMPLETED", "start")).toThrow(SimulationRunTransitionError);
    expect(() => nextStatus("COMPLETED", "resume")).toThrow(SimulationRunTransitionError);

    // The full legal path this table must still allow, for contrast:
    // DRAFT -[set_scenario]-> CONFIGURED -[start]-> RUNNING -[pause]->
    // PAUSED -[resume]-> RUNNING -[finish]-> COMPLETED.
    expect(isTransitionAllowed("DRAFT", "set_scenario")).toBe(true);
    expect(nextStatus("DRAFT", "set_scenario")).toBe("CONFIGURED");
    expect(nextStatus("CONFIGURED", "start")).toBe("RUNNING");
    expect(nextStatus("RUNNING", "pause")).toBe("PAUSED");
    expect(nextStatus("PAUSED", "resume")).toBe("RUNNING");
    expect(nextStatus("RUNNING", "finish")).toBe("COMPLETED");

    // A freshly COMPLETED run can only move forward again via a brand new
    // DRAFT run, never by resuming the completed one in place.
    expect(isTransitionAllowed("COMPLETED", "set_scenario")).toBe(false);
  });

  it("T-SPEC-VIEWER-001-NC-NC_SPRIG_NO_OVERWRITE_JOURNAL: a full simulation run never mutates GridCell/GridCellEvent, and exiting restores REAL exactly", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 1 } },
    });

    const beforeWaterSnapshot = await getWaterSnapshot(prisma);
    const beforeEventCount = await prisma.gridCellEvent.count();
    const beforeCellRow = await prisma.gridCell.findUniqueOrThrow({ where: { id: cell.id } });

    // Drive an entire simulation run — draft, configure a hypothetical
    // watering + simulated time, start/pause/resume/finish — targeting the
    // exact cell whose REAL journal must stay untouched throughout.
    const run = await createDraftRun(prisma);
    await configureRun(prisma, run.id, {
      waterInput: { [cell.id]: 5 },
      simulatedTime: new Date("2026-07-28T18:00:00.000Z"),
    });
    await startRun(prisma, run.id);
    await pauseRun(prisma, run.id);
    await resumeRun(prisma, run.id);
    await finishRun(prisma, run.id);

    // The REAL garden journal tables (GridCell, GridCellEvent) must be
    // byte-for-byte unchanged — SIMULATION-mode watering/time changes are
    // an overlay that lives only in SimulationRun.waterInput/affectedCells,
    // never a write to the real baseline tables.
    const afterEventCount = await prisma.gridCellEvent.count();
    expect(afterEventCount).toBe(beforeEventCount);

    const afterCellRow = await prisma.gridCell.findUniqueOrThrow({ where: { id: cell.id } });
    expect(afterCellRow.waterState).toBe(beforeCellRow.waterState);
    expect(afterCellRow.status).toBe(beforeCellRow.status);
    expect(afterCellRow.plantedAt).toEqual(beforeCellRow.plantedAt);

    // "exiting SIMULATION mode restores REAL exactly" — since nothing was
    // ever written to the REAL baseline, re-reading it directly already
    // reflects the unchanged state (same pattern as SPEC-IRRIGATION-001's
    // applySimulationWater overlay never persisting).
    const afterWaterSnapshot = await getWaterSnapshot(prisma);
    expect(afterWaterSnapshot).toEqual(beforeWaterSnapshot);

    // The hypothetical watering must be recoverable ONLY from the
    // SimulationRun row's own JSON blob, per prisma/schema.prisma's
    // SimulationRun.waterInput/affectedCells comment.
    const persistedRun = await prisma.simulationRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(persistedRun.status).toBe("COMPLETED");
    expect(JSON.parse(persistedRun.waterInput ?? "{}")).toEqual({ [cell.id]: 5 });
    expect(JSON.parse(persistedRun.affectedCells ?? "[]")).toEqual([cell.id]);
  });

  it("configureRun rejects a waterInput entry for a cell id that does not exist, instead of silently persisting a dangling reference", async () => {
    const run = await createDraftRun(prisma);
    await expect(
      configureRun(prisma, run.id, { waterInput: { "nonexistent-cell": 5 }, simulatedTime: null }),
    ).rejects.toThrow();
  });

  it("startRun/pauseRun/resumeRun/finishRun reject out-of-order calls at the service layer, not just the pure lifecycle table", async () => {
    const run = await createDraftRun(prisma);
    // Still DRAFT — never configured — starting must fail loudly.
    await expect(startRun(prisma, run.id)).rejects.toThrow(SimulationRunTransitionError);

    await configureRun(prisma, run.id, { waterInput: {}, simulatedTime: null });
    await startRun(prisma, run.id);
    await finishRun(prisma, run.id);

    // COMPLETED -> RUNNING must be rejected here too, not just by the pure
    // isTransitionAllowed/nextStatus functions above.
    await expect(startRun(prisma, run.id)).rejects.toThrow(SimulationRunTransitionError);
  });
});
