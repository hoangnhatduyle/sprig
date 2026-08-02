import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient, resetGridTables } from "./test-db";
import {
  addCompanionPlant,
  assignPlant,
  clearCell,
  germinate,
  getGardenSnapshot,
  grow,
  harvest,
  removeCell,
  removeCompanionPlant,
  resizeBedGeometry,
  seedBed,
} from "./grid-cell-service";
import { isTransitionAllowed, LifecycleTransitionError } from "./planting-lifecycle";
import {
  DuplicateCompanionPlantError,
  GeometryValidationError,
  JournalIntegrityViolationError,
  NoActivePlantingError,
} from "./errors";

// Traces to: /home/hoang/projects/Sprig/.claude/tests/SPEC-GRID-001.tests.yaml
// Each `it` below is named after its harness case id so validate_coverage
// results map 1:1 back to the generated test plan.

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetGridTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

afterAll(async () => {
  const cleanup = createTestPrismaClient();
  await resetGridTables(cleanup);
  await cleanup.$disconnect();
});

describe("SPEC-GRID-001", () => {
  it("T-SPEC-GRID-001-AC-AC_1: garden snapshot reflects both beds' geometry and reconciled per-cell plant state", async () => {
    const bedA = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const bedB = await seedBed(prisma, { name: "Bed 2", compassPosition: "NORTH" });

    const plant = await prisma.plant.create({ data: { commonName: "Tomato" } });
    await assignPlant(prisma, {
      bedId: bedA.id,
      column: 1,
      row: 1,
      plantId: plant.id,
    });

    const snapshot = await getGardenSnapshot(prisma);

    expect(snapshot.beds).toHaveLength(2);
    for (const bed of snapshot.beds) {
      expect(bed.gridCols).toBe(4);
      expect(bed.gridRows).toBe(8);
      expect(bed.cells).toHaveLength(32);
    }

    const plantedCell = snapshot.beds
      .find((bed) => bed.id === bedA.id)
      ?.cells.find((cell) => cell.column === 1 && cell.row === 1);
    expect(plantedCell?.plantIds).toContain(plant.id);

    const emptyCell = snapshot.beds
      .find((bed) => bed.id === bedA.id)
      ?.cells.find((cell) => cell.column === 2 && cell.row === 1);
    expect(emptyCell?.plantIds).toEqual([]);
    expect(emptyCell?.status).toBe("EMPTY");

    const untouchedBed = snapshot.beds.find((bed) => bed.id === bedB.id);
    expect(untouchedBed?.cells.every((cell) => cell.plantIds.length === 0)).toBe(true);
  });

  it("T-SPEC-GRID-001-AC-AC_2: reassigning a cell's plant updates current state and preserves prior event history", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const tomato = await prisma.plant.create({ data: { commonName: "Tomato" } });
    const basil = await prisma.plant.create({ data: { commonName: "Basil" } });

    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: tomato.id });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: basil.id });

    const cell = await prisma.gridCell.findFirstOrThrow({
      where: { bedId: bed.id, column: 1, row: 1 },
      include: { cellPlantings: true, events: true },
    });

    expect(cell.cellPlantings.some((p) => p.plantId === basil.id && p.removedAt === null)).toBe(
      true,
    );
    // Prior event history must not be erased by the second assignment.
    expect(cell.events.length).toBeGreaterThanOrEqual(2);
    expect(cell.events.some((e) => e.plantId === tomato.id)).toBe(true);
    expect(cell.events.some((e) => e.plantId === basil.id)).toBe(true);
  });

  it("T-SPEC-GRID-001-FORBID-Grid_cell_planting_lifecycle_HARVESTED_GROWING: HARVESTED -> GROWING is rejected", () => {
    expect(isTransitionAllowed("HARVESTED", "grow")).toBe(false);
  });

  it("T-SPEC-GRID-001-FORBID-Grid_cell_planting_lifecycle_EMPTY_GERMINATED: EMPTY -> GERMINATED is rejected", () => {
    expect(isTransitionAllowed("EMPTY", "germinate")).toBe(false);
  });

  it("T-SPEC-GRID-001-NC-NC_SPRIG_NO_OVERWRITE_JOURNAL: journal events are append-only, never mutated or replaced", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Tomato" } });

    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const firstEvent = await prisma.gridCellEvent.findFirstOrThrow({
      where: { cell: { bedId: bed.id, column: 1, row: 1 } },
    });

    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    const events = await prisma.gridCellEvent.findMany({
      where: { cell: { bedId: bed.id, column: 1, row: 1 } },
      orderBy: { occurredAt: "asc" },
    });

    // First call: 1 PLANTED event. Second call: the first planting is
    // evicted (1 REMOVED event) and the new one is journaled (1 PLANTED
    // event) — every plant-assignment change gets its own event, none reuse
    // or overwrite another's row.
    expect(events).toHaveLength(3);
    // Not just "more rows exist" — the original row's own fields must be
    // byte-for-byte unchanged, proving it was never mutated in place.
    expect(events[0]).toEqual(firstEvent);
  });

  it("assignPlant rolls back cleanly when the referenced plant does not exist (no silent journal loss on a failed write)", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const tomato = await prisma.plant.create({ data: { commonName: "Tomato" } });

    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: tomato.id });

    await expect(
      assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: "does-not-exist" }),
    ).rejects.toThrow();

    const cell = await prisma.gridCell.findFirstOrThrow({
      where: { bedId: bed.id, column: 1, row: 1 },
      include: { cellPlantings: true, events: true },
    });

    // The failed second assignment must not have soft-removed the first
    // planting or otherwise left the cell in a half-changed state.
    expect(cell.cellPlantings.some((p) => p.plantId === tomato.id && p.removedAt === null)).toBe(
      true,
    );
    expect(cell.events).toHaveLength(1);
  });

  it("T-SPEC-GRID-001-NC-NC_SPRIG_GRID_IMMUTABLE_GEOMETRY: bed geometry cannot be resized without an explicit dated renovation record", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });

    await expect(
      resizeBedGeometry(prisma, { bedId: bed.id, gridCols: 5, gridRows: 8 }),
    ).rejects.toThrow(GeometryValidationError);

    await resizeBedGeometry(prisma, {
      bedId: bed.id,
      gridCols: 5,
      gridRows: 8,
      renovation: { note: "Widened bed after fence move", occurredAt: new Date() },
    });

    const resized = await prisma.bed.findUniqueOrThrow({ where: { id: bed.id } });
    expect(resized.gridCols).toBe(5);
    expect(resized.gridRows).toBe(8);

    const cellCount = await prisma.gridCell.count({ where: { bedId: bed.id } });
    expect(cellCount).toBe(5 * 8);

    const renovationRecords = await prisma.bedRenovation.count({ where: { bedId: bed.id } });
    expect(renovationRecords).toBe(1);
  });

  it("resizeBedGeometry rejects non-integer dimensions and an empty renovation note", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });

    await expect(
      resizeBedGeometry(prisma, {
        bedId: bed.id,
        gridCols: 4.5,
        gridRows: 8,
        renovation: { note: "Widened bed", occurredAt: new Date() },
      }),
    ).rejects.toThrow(GeometryValidationError);

    await expect(
      resizeBedGeometry(prisma, {
        bedId: bed.id,
        gridCols: 5,
        gridRows: 8,
        renovation: { note: "   ", occurredAt: new Date() },
      }),
    ).rejects.toThrow(GeometryValidationError);
  });

  it("resizeBedGeometry rejects shrinking a bed when a removed cell has planting/journal history", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const tomato = await prisma.plant.create({ data: { commonName: "Tomato" } });

    // Plant into the last column (column 4) — shrinking to 3 columns would remove it.
    await assignPlant(prisma, { bedId: bed.id, column: 4, row: 1, plantId: tomato.id });

    await expect(
      resizeBedGeometry(prisma, {
        bedId: bed.id,
        gridCols: 3,
        gridRows: 8,
        renovation: { note: "Narrowed bed", occurredAt: new Date() },
      }),
    ).rejects.toThrow(JournalIntegrityViolationError);

    // Geometry must be untouched by the rejected resize.
    const bedAfter = await prisma.bed.findUniqueOrThrow({ where: { id: bed.id } });
    expect(bedAfter.gridCols).toBe(4);
  });

  it("resizeBedGeometry recomputes baselineLight for pre-existing cells, not just newly added ones", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });

    // 8-row bed: row 5 is past the midpoint (4) -> FULL_SUN.
    const rowFiveBefore = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 5 } },
    });
    expect(rowFiveBefore.baselineLight).toBe("FULL_SUN");

    // Growing to 10 rows moves the midpoint to 5 -> row 5 is now PARTIAL_SHADE.
    await resizeBedGeometry(prisma, {
      bedId: bed.id,
      gridCols: 4,
      gridRows: 10,
      renovation: { note: "Extended bed lengthwise", occurredAt: new Date() },
    });

    const rowFiveAfter = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: bed.id, column: 1, row: 5 } },
    });
    expect(rowFiveAfter.baselineLight).toBe("PARTIAL_SHADE");
  });

  it("a cell can be walked through its full real lifecycle: PLANTED -> GERMINATED -> GROWING -> HARVESTED -> REMOVED -> PLANTED again", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const tomato = await prisma.plant.create({ data: { commonName: "Tomato" } });
    const loc = { bedId: bed.id, column: 1, row: 1 };

    await assignPlant(prisma, { ...loc, plantId: tomato.id });
    await germinate(prisma, loc);
    await grow(prisma, loc);
    await harvest(prisma, loc);
    await clearCell(prisma, loc);

    const afterClear = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: loc.bedId, column: loc.column, row: loc.row } },
      include: { events: true, cellPlantings: true },
    });
    expect(afterClear.status).toBe("REMOVED");
    // assign, germinate, grow, harvest, clear -> 5 journal events, all preserved.
    expect(afterClear.events).toHaveLength(5);
    expect(afterClear.cellPlantings.every((p) => p.removedAt !== null)).toBe(true);

    // REMOVED -> PLANTED is a legal transition (a new planting cycle).
    const basil = await prisma.plant.create({ data: { commonName: "Basil" } });
    await assignPlant(prisma, { ...loc, plantId: basil.id });
    const replanted = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: loc.bedId, column: loc.column, row: loc.row } },
    });
    expect(replanted.status).toBe("PLANTED");
  });

  it("removeCell vacates a mid-cycle (non-HARVESTED) cell directly to REMOVED and soft-removes its planting", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const tomato = await prisma.plant.create({ data: { commonName: "Tomato" } });
    const loc = { bedId: bed.id, column: 1, row: 1 };

    await assignPlant(prisma, { ...loc, plantId: tomato.id });
    await germinate(prisma, loc);
    await removeCell(prisma, loc);

    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: loc.bedId, column: loc.column, row: loc.row } },
      include: { cellPlantings: true },
    });
    expect(cell.status).toBe("REMOVED");
    expect(cell.cellPlantings.every((p) => p.removedAt !== null)).toBe(true);
  });

  it("forbidden transitions are rejected at the persistence layer too, not just in the in-memory transition table", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const loc = { bedId: bed.id, column: 1, row: 1 };

    // EMPTY -> GERMINATED without ever planting.
    await expect(germinate(prisma, loc)).rejects.toThrow(LifecycleTransitionError);

    const tomato = await prisma.plant.create({ data: { commonName: "Tomato" } });
    await assignPlant(prisma, { ...loc, plantId: tomato.id });
    await germinate(prisma, loc);
    await grow(prisma, loc);
    await harvest(prisma, loc);

    // HARVESTED -> GROWING.
    await expect(grow(prisma, loc)).rejects.toThrow(LifecycleTransitionError);
  });

  it("addCompanionPlant lets two plants be simultaneously active on the same cell, and rejects a duplicate", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const tomato = await prisma.plant.create({ data: { commonName: "Tomato" } });
    const basil = await prisma.plant.create({ data: { commonName: "Basil" } });
    const loc = { bedId: bed.id, column: 1, row: 1 };

    await assignPlant(prisma, { ...loc, plantId: tomato.id });
    await addCompanionPlant(prisma, { ...loc, plantId: basil.id });

    const snapshot = await getGardenSnapshot(prisma);
    const cell = snapshot.beds[0]?.cells.find((c) => c.column === 1 && c.row === 1);
    expect(cell?.plantIds).toEqual(expect.arrayContaining([tomato.id, basil.id]));
    expect(cell?.plantIds).toHaveLength(2);
    // The status transition remains driven by the primary planting, not reset by the companion.
    expect(cell?.status).toBe("PLANTED");

    await expect(addCompanionPlant(prisma, { ...loc, plantId: basil.id })).rejects.toThrow(
      DuplicateCompanionPlantError,
    );
  });

  it("assignPlant onto a mid-cycle cell resets status/journal to PLANTED, not the stale prior status, and journals the evicted plant's removal", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const tomato = await prisma.plant.create({ data: { commonName: "Tomato" } });
    const basil = await prisma.plant.create({ data: { commonName: "Basil" } });
    const loc = { bedId: bed.id, column: 1, row: 1 };

    await assignPlant(prisma, { ...loc, plantId: tomato.id });
    await germinate(prisma, loc);
    await grow(prisma, loc);

    await assignPlant(prisma, { ...loc, plantId: basil.id });

    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: loc.bedId, column: loc.column, row: loc.row } },
      include: { events: true },
    });
    expect(cell.status).toBe("PLANTED");

    const basilPlantedEvent = cell.events.find(
      (e) => e.plantId === basil.id && e.eventType === "PLANTED",
    );
    expect(basilPlantedEvent).toBeDefined();

    // Tomato's eviction must itself be journaled, not silently dropped.
    const tomatoRemovedEvent = cell.events.find(
      (e) => e.plantId === tomato.id && e.eventType === "REMOVED",
    );
    expect(tomatoRemovedEvent).toBeDefined();
  });

  it("a companion pair walked through the lifecycle gets a journal event for BOTH plants at every stage", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const tomato = await prisma.plant.create({ data: { commonName: "Tomato" } });
    const basil = await prisma.plant.create({ data: { commonName: "Basil" } });
    const loc = { bedId: bed.id, column: 1, row: 1 };

    await assignPlant(prisma, { ...loc, plantId: tomato.id });
    await addCompanionPlant(prisma, { ...loc, plantId: basil.id });

    await germinate(prisma, loc);
    await grow(prisma, loc);
    await harvest(prisma, loc);

    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: loc.bedId, column: loc.column, row: loc.row } },
      include: { events: true },
    });

    for (const status of ["GERMINATED", "GROWING", "HARVESTED"] as const) {
      const tomatoEvent = cell.events.find(
        (e) => e.plantId === tomato.id && e.eventType === status,
      );
      const basilEvent = cell.events.find((e) => e.plantId === basil.id && e.eventType === status);
      expect(tomatoEvent, `expected a ${status} event for tomato`).toBeDefined();
      expect(basilEvent, `expected a ${status} event for basil`).toBeDefined();
    }
  });

  it("removeCompanionPlant removes exactly one active plant, journals it, and rejects removing the last one", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const tomato = await prisma.plant.create({ data: { commonName: "Tomato" } });
    const basil = await prisma.plant.create({ data: { commonName: "Basil" } });
    const loc = { bedId: bed.id, column: 1, row: 1 };

    await assignPlant(prisma, { ...loc, plantId: tomato.id });
    await addCompanionPlant(prisma, { ...loc, plantId: basil.id });

    await removeCompanionPlant(prisma, { ...loc, plantId: basil.id });

    const snapshot = await getGardenSnapshot(prisma);
    const cell = snapshot.beds[0]?.cells.find((c) => c.column === 1 && c.row === 1);
    expect(cell?.plantIds).toEqual([tomato.id]);
    // Tomato's lifecycle status must be untouched by removing its companion.
    expect(cell?.status).toBe("PLANTED");

    const cellRow = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: loc.bedId, column: loc.column, row: loc.row } },
      include: { events: true },
    });
    expect(
      cellRow.events.some((e) => e.plantId === basil.id && e.eventType === "REMOVED"),
    ).toBe(true);

    // Removing the last active planting through this path is rejected —
    // that's removeCell/clearCell's job (a lifecycle transition), not a plant edit.
    await expect(
      removeCompanionPlant(prisma, { ...loc, plantId: tomato.id }),
    ).rejects.toThrow(NoActivePlantingError);
  });

  it("T-SPEC-GRID-001-NC-NC_SPRIG_NO_SILENT_PLANT_CHANGE: every plant assignment change records a dated event", async () => {
    const bed = await seedBed(prisma, { name: "Bed 1", compassPosition: "SOUTH" });
    const plant = await prisma.plant.create({ data: { commonName: "Tomato" } });

    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });

    const events = await prisma.gridCellEvent.findMany({
      where: { cell: { bedId: bed.id, column: 1, row: 1 } },
    });

    expect(events).toHaveLength(1);
    expect(events[0].plantId).toBe(plant.id);
    expect(events[0].occurredAt).toBeInstanceOf(Date);
  });
});
