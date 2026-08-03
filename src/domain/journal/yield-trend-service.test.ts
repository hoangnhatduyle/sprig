import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignInventoryPlant, seedBed } from "@/domain/grid/grid-cell-service";
import { createTestPrismaClient, resetGridTables } from "@/domain/grid/test-db";
import { createInventoryPlant } from "@/domain/plant-catalog/inventory-service";
import { getYieldTrend } from "./yield-trend-service";

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetGridTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

async function plantInCell(
  bedName: string,
  plantName: string,
  column: number,
  row: number,
): Promise<{ bedId: string; plantId: string; cellPlantingId: string }> {
  const bed = await seedBed(prisma, { name: bedName, compassPosition: "SOUTH" });
  const plant = await createInventoryPlant(prisma, { commonName: plantName, seedQuantity: 10, seedUnit: "seed" });
  await assignInventoryPlant(prisma, { bedId: bed.id, column, row, plantId: plant.id, amount: 1, mode: "replace" });
  const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
  return { bedId: bed.id, plantId: plant.id, cellPlantingId: planting.id };
}

describe("getYieldTrend", () => {
  it("returns an empty array when no harvests exist in range", async () => {
    const result = await getYieldTrend(prisma, {
      since: new Date("2026-01-01T00:00:00.000Z"),
      until: new Date("2026-01-31T00:00:00.000Z"),
    });
    expect(result).toEqual([]);
  });

  it("groups harvests by UTC day and sums amounts sharing a unit", async () => {
    const { plantId, cellPlantingId } = await plantInCell("Left", "Tomato", 1, 1);
    await prisma.harvestRecord.createMany({
      data: [
        { cellPlantingId, plantId, amount: 2, unit: "kg", harvestedAt: new Date("2026-06-01T08:00:00.000Z") },
        { cellPlantingId, plantId, amount: 3, unit: "kg", harvestedAt: new Date("2026-06-01T18:00:00.000Z") },
        { cellPlantingId, plantId, amount: 1, unit: "kg", harvestedAt: new Date("2026-06-02T08:00:00.000Z") },
      ],
    });

    const result = await getYieldTrend(prisma, {
      since: new Date("2026-06-01T00:00:00.000Z"),
      until: new Date("2026-06-30T23:59:59.999Z"),
    });

    expect(result).toEqual([
      { dateIso: "2026-06-01", totalsByUnit: [{ unit: "kg", amount: 5 }] },
      { dateIso: "2026-06-02", totalsByUnit: [{ unit: "kg", amount: 1 }] },
    ]);
  });

  it("keeps separate units within the same day distinct instead of summing across units", async () => {
    const { plantId, cellPlantingId } = await plantInCell("Right", "Bean", 1, 1);
    await prisma.harvestRecord.createMany({
      data: [
        { cellPlantingId, plantId, amount: 4, unit: "pod", harvestedAt: new Date("2026-06-01T08:00:00.000Z") },
        { cellPlantingId, plantId, amount: 2, unit: "kg", harvestedAt: new Date("2026-06-01T09:00:00.000Z") },
      ],
    });

    const result = await getYieldTrend(prisma, {
      since: new Date("2026-06-01T00:00:00.000Z"),
      until: new Date("2026-06-01T23:59:59.999Z"),
    });

    expect(result).toEqual([
      {
        dateIso: "2026-06-01",
        totalsByUnit: [
          { unit: "kg", amount: 2 },
          { unit: "pod", amount: 4 },
        ],
      },
    ]);
  });

  it("filters by bedId, excluding harvests from other beds", async () => {
    const beanBed = await plantInCell("BedA", "Bean", 1, 1);
    const tomatoBed = await plantInCell("BedB", "Tomato", 1, 1);
    await prisma.harvestRecord.createMany({
      data: [
        {
          cellPlantingId: beanBed.cellPlantingId,
          plantId: beanBed.plantId,
          amount: 5,
          unit: "pod",
          harvestedAt: new Date("2026-06-01T08:00:00.000Z"),
        },
        {
          cellPlantingId: tomatoBed.cellPlantingId,
          plantId: tomatoBed.plantId,
          amount: 9,
          unit: "kg",
          harvestedAt: new Date("2026-06-01T08:00:00.000Z"),
        },
      ],
    });

    const result = await getYieldTrend(prisma, {
      since: new Date("2026-06-01T00:00:00.000Z"),
      until: new Date("2026-06-01T23:59:59.999Z"),
      bedId: beanBed.bedId,
    });

    expect(result).toEqual([{ dateIso: "2026-06-01", totalsByUnit: [{ unit: "pod", amount: 5 }] }]);
  });

  it("filters by plantId, excluding harvests from other plants", async () => {
    const bean = await plantInCell("BedC1", "Bean", 1, 1);
    const tomato = await plantInCell("BedC2", "Tomato", 1, 1);
    await prisma.harvestRecord.createMany({
      data: [
        {
          cellPlantingId: bean.cellPlantingId,
          plantId: bean.plantId,
          amount: 5,
          unit: "pod",
          harvestedAt: new Date("2026-06-01T08:00:00.000Z"),
        },
        {
          cellPlantingId: tomato.cellPlantingId,
          plantId: tomato.plantId,
          amount: 9,
          unit: "kg",
          harvestedAt: new Date("2026-06-01T08:00:00.000Z"),
        },
      ],
    });

    const result = await getYieldTrend(prisma, {
      since: new Date("2026-06-01T00:00:00.000Z"),
      until: new Date("2026-06-01T23:59:59.999Z"),
      plantId: tomato.plantId,
    });

    expect(result).toEqual([{ dateIso: "2026-06-01", totalsByUnit: [{ unit: "kg", amount: 9 }] }]);
  });

  it("excludes harvests outside the since/until range", async () => {
    const { plantId, cellPlantingId } = await plantInCell("BedD", "Tomato", 1, 1);
    await prisma.harvestRecord.createMany({
      data: [
        { cellPlantingId, plantId, amount: 1, unit: "kg", harvestedAt: new Date("2026-05-31T23:59:59.000Z") },
        { cellPlantingId, plantId, amount: 2, unit: "kg", harvestedAt: new Date("2026-06-01T00:00:00.000Z") },
        { cellPlantingId, plantId, amount: 3, unit: "kg", harvestedAt: new Date("2026-07-01T00:00:00.001Z") },
      ],
    });

    const result = await getYieldTrend(prisma, {
      since: new Date("2026-06-01T00:00:00.000Z"),
      until: new Date("2026-06-30T23:59:59.999Z"),
    });

    expect(result).toEqual([{ dateIso: "2026-06-01", totalsByUnit: [{ unit: "kg", amount: 2 }] }]);
  });
});
