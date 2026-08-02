import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignInventoryPlant,
  assignPlant,
  germinate,
  grow,
  recordHarvest,
  resizeBedGeometry,
  seedBed,
} from "@/domain/grid/grid-cell-service";
import { createTestPrismaClient, resetGridTables } from "@/domain/grid/test-db";
import { resetGrowthTables } from "@/domain/growth/test-db";
import { resetConditionsTables } from "@/domain/conditions/test-db";
import { createInventoryPlant } from "@/domain/plant-catalog/inventory-service";
import { applyMulchToCell } from "@/domain/soil/care-actions-service";
import { installConditionOverride } from "@/domain/conditions/bed-condition-override-service";
import { getGardenJournal } from "./journal-service";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-JOURNAL-001.yaml

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetConditionsTables(prisma);
  await resetGrowthTables(prisma);
  await resetGridTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

afterAll(async () => {
  const cleanup = createTestPrismaClient();
  await resetConditionsTables(cleanup);
  await resetGrowthTables(cleanup);
  await resetGridTables(cleanup);
  await cleanup.$disconnect();
});

describe("getGardenJournal", () => {
  it("T-SPEC-JOURNAL-001-AC-AC_1: merges lifecycle, harvest, and care-action entries into one feed sorted newest-first", async () => {
    const bed = await seedBed(prisma, { name: "Journal Bed", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, { commonName: "Tomato", seedQuantity: 5, seedUnit: "seed" });

    await assignInventoryPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id, amount: 1, mode: "replace" });
    await applyMulchToCell(prisma, { bedId: bed.id, column: 1, row: 1, depthMm: 30 });
    await germinate(prisma, { bedId: bed.id, column: 1, row: 1 });
    await grow(prisma, { bedId: bed.id, column: 1, row: 1 });
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    await recordHarvest(prisma, { cellPlantingId: planting.id, amount: 3, unit: "item" });

    const journal = await getGardenJournal(prisma);

    const kinds = journal.entries.map((entry) => entry.kind);
    expect(kinds).toEqual(expect.arrayContaining(["LIFECYCLE", "CARE_ACTION", "HARVEST"]));
    // Newest first.
    const timestamps = journal.entries.map((entry) => new Date(entry.occurredAt).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("T-SPEC-JOURNAL-001-AC-AC_2: excludes system-driven GERMINATED/GROWING lifecycle events by default, includes them when requested", async () => {
    const bed = await seedBed(prisma, { name: "Auto Bed", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, { commonName: "Bean", seedQuantity: 5, seedUnit: "seed" });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    await germinate(prisma, { bedId: bed.id, column: 1, row: 1 });

    const withoutSystem = await getGardenJournal(prisma);
    expect(withoutSystem.entries.some((entry) => entry.kind === "LIFECYCLE" && entry.eventType === "GERMINATED")).toBe(false);
    expect(withoutSystem.entries.some((entry) => entry.kind === "LIFECYCLE" && entry.eventType === "PLANTED")).toBe(true);

    const withSystem = await getGardenJournal(prisma, { includeSystemLifecycleEvents: true });
    expect(withSystem.entries.some((entry) => entry.kind === "LIFECYCLE" && entry.eventType === "GERMINATED")).toBe(true);
  });

  it("T-SPEC-JOURNAL-001-AC-AC_3: BedConditionOverride install produces one entry, and a second 'removed' entry once removedAt is set", async () => {
    const bed = await seedBed(prisma, { name: "Equip Bed", compassPosition: "SOUTH" });
    const override = await installConditionOverride(prisma, { bedId: bed.id, kind: "SHADE_CLOTH", intensity: 0.5 });

    const afterInstall = await getGardenJournal(prisma, { kinds: ["EQUIPMENT"] });
    expect(afterInstall.entries).toHaveLength(1);
    expect(afterInstall.entries[0]).toMatchObject({ kind: "EQUIPMENT", phase: "installed" });

    await prisma.bedConditionOverride.update({ where: { id: override.id }, data: { removedAt: new Date() } });
    const afterRemove = await getGardenJournal(prisma, { kinds: ["EQUIPMENT"] });
    expect(afterRemove.entries).toHaveLength(2);
    expect(afterRemove.entries.map((entry) => entry.kind === "EQUIPMENT" && entry.phase)).toEqual(
      expect.arrayContaining(["installed", "removed"]),
    );
  });

  it("filters by bedId, excluding entries from other beds", async () => {
    const bedA = await seedBed(prisma, { name: "Bed A", compassPosition: "SOUTH" });
    const bedB = await seedBed(prisma, { name: "Bed B", compassPosition: "NORTH" });
    await applyMulchToCell(prisma, { bedId: bedA.id, column: 1, row: 1, depthMm: 20 });
    await applyMulchToCell(prisma, { bedId: bedB.id, column: 1, row: 1, depthMm: 40 });

    const journal = await getGardenJournal(prisma, { bedId: bedA.id, kinds: ["CARE_ACTION"] });
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0].bedId).toBe(bedA.id);
  });

  it("records a BedRenovation as a RENOVATION entry", async () => {
    const bed = await seedBed(prisma, { name: "Resize Bed", compassPosition: "SOUTH" });
    await resizeBedGeometry(prisma, {
      bedId: bed.id,
      gridCols: bed.gridCols + 1,
      gridRows: bed.gridRows,
      renovation: { note: "Widened for fall planting", occurredAt: new Date() },
    });

    const journal = await getGardenJournal(prisma, { kinds: ["RENOVATION"] });
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0]).toMatchObject({ kind: "RENOVATION", note: "Widened for fall planting" });
  });

  it("paginates with limit/offset and reports hasMore", async () => {
    const bed = await seedBed(prisma, { name: "Paginated Bed", compassPosition: "SOUTH" });
    for (let i = 0; i < 5; i += 1) {
      await applyMulchToCell(prisma, { bedId: bed.id, column: 1, row: 1, depthMm: 10 + i });
    }

    const firstPage = await getGardenJournal(prisma, { kinds: ["CARE_ACTION"], limit: 2, offset: 0 });
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);

    const lastPage = await getGardenJournal(prisma, { kinds: ["CARE_ACTION"], limit: 2, offset: 4 });
    expect(lastPage.entries).toHaveLength(1);
    expect(lastPage.hasMore).toBe(false);
  });

  it("excludes non-plant-associated kinds when filtering by plantId", async () => {
    const bed = await seedBed(prisma, { name: "Plant Filter Bed", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, { commonName: "Squash", seedQuantity: 5, seedUnit: "seed" });
    await assignInventoryPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id, amount: 1, mode: "replace" });
    await applyMulchToCell(prisma, { bedId: bed.id, column: 1, row: 1, depthMm: 15 });

    const journal = await getGardenJournal(prisma, { plantId: plant.id });
    expect(journal.entries.every((entry) => entry.kind !== "CARE_ACTION")).toBe(true);
    expect(journal.entries.some((entry) => entry.kind === "LIFECYCLE")).toBe(true);
  });
});
