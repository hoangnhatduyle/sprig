import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignInventoryPlant,
  germinate,
  grow,
  recordHarvest,
  seedBed,
} from "@/domain/grid/grid-cell-service";
import { createTestPrismaClient, resetGridTables } from "@/domain/grid/test-db";
import {
  createInventoryPlant,
  deleteInventoryPlant,
  getInventorySnapshot,
  InventoryValidationError,
} from "./inventory-service";

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetGridTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

describe("inventory and repeat harvests", () => {
  it("consumes stock atomically when a plant is dropped", async () => {
    const bed = await seedBed(prisma, { name: "Left", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, {
      commonName: "Tomato",
      seedQuantity: 5,
      seedUnit: "seed",
    });

    await assignInventoryPlant(prisma, {
      bedId: bed.id,
      column: 1,
      row: 1,
      plantId: plant.id,
      amount: 2,
      mode: "replace",
    });

    expect((await prisma.plant.findUniqueOrThrow({ where: { id: plant.id } })).seedQuantity).toBe(3);
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    expect(planting).toMatchObject({ seedQuantityUsed: 2, seedUnit: "seed" });

    await expect(
      assignInventoryPlant(prisma, {
        bedId: bed.id,
        column: 2,
        row: 1,
        plantId: plant.id,
        amount: 4,
        mode: "replace",
      }),
    ).rejects.toBeInstanceOf(InventoryValidationError);
    expect((await prisma.plant.findUniqueOrThrow({ where: { id: plant.id } })).seedQuantity).toBe(3);
  });

  it("records multiple yields without ending the growing planting", async () => {
    const bed = await seedBed(prisma, { name: "Right", compassPosition: "NORTH" });
    const plant = await createInventoryPlant(prisma, {
      commonName: "Bean",
      seedQuantity: 4,
      seedUnit: "seed",
    });
    await assignInventoryPlant(prisma, {
      bedId: bed.id,
      column: 1,
      row: 1,
      plantId: plant.id,
      amount: 1,
      mode: "replace",
    });
    await germinate(prisma, { bedId: bed.id, column: 1, row: 1 });
    await grow(prisma, { bedId: bed.id, column: 1, row: 1 });
    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });

    await recordHarvest(prisma, { cellPlantingId: planting.id, amount: 3, unit: "pod" });
    await recordHarvest(prisma, { cellPlantingId: planting.id, amount: 2, unit: "pod" });

    expect(await prisma.harvestRecord.count({ where: { cellPlantingId: planting.id } })).toBe(2);
    expect((await prisma.gridCell.findFirstOrThrow({ where: { bedId: bed.id } })).status).toBe("GROWING");
    const inventory = await getInventorySnapshot(prisma);
    expect(inventory.yields.map((entry) => entry.amount).sort()).toEqual([2, 3]);
  });

  it("archives a plant that has journal history", async () => {
    const bed = await seedBed(prisma, { name: "History", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, {
      commonName: "Pea",
      seedQuantity: 1,
      seedUnit: "seed",
    });
    await assignInventoryPlant(prisma, {
      bedId: bed.id,
      column: 1,
      row: 1,
      plantId: plant.id,
      amount: 1,
      mode: "replace",
    });

    expect(await deleteInventoryPlant(prisma, plant.id)).toBe("archived");
    expect((await getInventorySnapshot(prisma)).seeds).toEqual([]);
    expect((await prisma.plant.findUniqueOrThrow({ where: { id: plant.id } })).archivedAt).not.toBeNull();
  });
});
