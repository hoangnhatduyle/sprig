import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignPlant, seedBed } from "@/domain/grid/grid-cell-service";
import { createTestPrismaClient, resetGridTables } from "@/domain/grid/test-db";
import { resetGrowthTables } from "@/domain/growth/test-db";
import { createInventoryPlant } from "@/domain/plant-catalog/inventory-service";
import { applyFungicideToCell } from "./disease-action-service";

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

describe("applyFungicideToCell CareActionEvent recording", () => {
  it("T-SPEC-JOURNAL-001-AC-AC_5-fungicide: writes one FUNGICIDE CareActionEvent per application, regardless of infection count", async () => {
    const bed = await seedBed(prisma, { name: "Disease Bed", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, { commonName: "Cucumber", seedQuantity: 5, seedUnit: "seed" });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    await prisma.diseaseInfection.create({
      data: { cellPlantingId: planting.id, diseaseKey: "powdery-mildew", severity: 0.5 },
    });

    const treated = await applyFungicideToCell(prisma, { bedId: bed.id, column: 1, row: 1 });
    expect(treated).toBe(1);

    const events = await prisma.careActionEvent.findMany({ where: { bedId: bed.id, actionType: "FUNGICIDE" } });
    expect(events).toHaveLength(1);
    expect(events[0].cellId).not.toBeNull();
  });
});
