import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignPlant, seedBed } from "@/domain/grid/grid-cell-service";
import { createTestPrismaClient, resetGridTables } from "@/domain/grid/test-db";
import { resetGrowthTables } from "@/domain/growth/test-db";
import { createInventoryPlant } from "@/domain/plant-catalog/inventory-service";
import { applyCompostToCell, applyFertilizerToCell, applyMulchToCell, applyWeedingToCell } from "./care-actions-service";

// Traces to: /home/hoang/projects/Sprig/.claude/specifications/SPEC-JOURNAL-001.yaml (AC-5)

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

async function seedCell() {
  const bed = await seedBed(prisma, { name: "Care Bed", compassPosition: "SOUTH" });
  const plant = await createInventoryPlant(prisma, { commonName: "Lettuce", seedQuantity: 5, seedUnit: "seed" });
  await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
  return bed;
}

describe("care-actions-service CareActionEvent recording", () => {
  it("T-SPEC-JOURNAL-001-AC-AC_5-mulch: applyMulchToCell writes a MULCH CareActionEvent alongside the state update", async () => {
    const bed = await seedCell();
    await applyMulchToCell(prisma, { bedId: bed.id, column: 1, row: 1, depthMm: 25 });

    const events = await prisma.careActionEvent.findMany({ where: { bedId: bed.id, actionType: "MULCH" } });
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].detail ?? "{}")).toMatchObject({ depthMm: 25 });
  });

  it("T-SPEC-JOURNAL-001-AC-AC_5-compost: applyCompostToCell writes a COMPOST CareActionEvent", async () => {
    const bed = await seedCell();
    await applyCompostToCell(prisma, { bedId: bed.id, column: 1, row: 1, amount: 0.4 });

    const events = await prisma.careActionEvent.findMany({ where: { bedId: bed.id, actionType: "COMPOST" } });
    expect(events).toHaveLength(1);
  });

  it("T-SPEC-JOURNAL-001-AC-AC_5-fertilizer: applyFertilizerToCell writes a FERTILIZER CareActionEvent for both kinds", async () => {
    const bed = await seedCell();
    await applyFertilizerToCell(prisma, { bedId: bed.id, column: 1, row: 1, kind: "SYNTHETIC", n: 0.1, p: 0.1, k: 0.1 });

    const events = await prisma.careActionEvent.findMany({ where: { bedId: bed.id, actionType: "FERTILIZER" } });
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].detail ?? "{}")).toMatchObject({ kind: "SYNTHETIC" });
  });

  it("T-SPEC-JOURNAL-001-AC-AC_5-weeding: applyWeedingToCell writes a WEEDING CareActionEvent", async () => {
    const bed = await seedCell();
    await applyWeedingToCell(prisma, { bedId: bed.id, column: 1, row: 1 });

    const events = await prisma.careActionEvent.findMany({ where: { bedId: bed.id, actionType: "WEEDING" } });
    expect(events).toHaveLength(1);
  });
});
