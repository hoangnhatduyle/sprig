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
import { ensureSpeciesCatalogSeeded } from "@/domain/growth/species-catalog";
import {
  createInventoryPlant,
  deleteInventoryPlant,
  getInventorySnapshot,
  InventoryValidationError,
  updateInventoryPlant,
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

describe("speciesProfileId stickiness", () => {
  // Sticky means: an explicitly-supplied speciesProfileId is never
  // re-derived from commonName, matching how the real caller
  // (InventoryPanel.tsx's PlantForm) always resubmits the currently-picked
  // id — never re-guessing the species just because the name changed. This
  // is distinct from "omitted from the input entirely," which still falls
  // back to the keyword guess (fixture call sites across the codebase rely
  // on exactly that fallback).
  it("keeps speciesProfileId sticky across updates instead of re-guessing from a changed name", async () => {
    const plant = await createInventoryPlant(prisma, {
      commonName: "Roma Tomato",
      seedQuantity: 5,
      seedUnit: "seed",
    });
    expect(plant.speciesProfileName).toBe("Tomato");

    const updated = await updateInventoryPlant(prisma, plant.id, {
      commonName: "Cabbage",
      speciesProfileId: plant.speciesProfileId,
      seedQuantity: 5,
      seedUnit: "seed",
    });

    expect(updated.speciesProfileId).toBe(plant.speciesProfileId);
    expect(updated.speciesProfileName).toBe("Tomato");
  });

  it("falls back to guessing from commonName when speciesProfileId is omitted entirely (fixture call sites)", async () => {
    const plant = await createInventoryPlant(prisma, {
      commonName: "Roma Tomato",
      seedQuantity: 5,
      seedUnit: "seed",
    });
    expect(plant.speciesProfileName).toBe("Tomato");

    const updated = await updateInventoryPlant(prisma, plant.id, {
      commonName: "Cabbage",
      seedQuantity: 5,
      seedUnit: "seed",
    });

    expect(updated.speciesProfileId).not.toBe(plant.speciesProfileId);
    expect(updated.speciesProfileName).toBe("Cabbage");
  });

  it("switches speciesProfileId only when the caller explicitly supplies a new one", async () => {
    await ensureSpeciesCatalogSeeded(prisma);
    const cabbage = await prisma.speciesProfile.findUniqueOrThrow({ where: { key: "cabbage" } });
    const plant = await createInventoryPlant(prisma, {
      commonName: "Roma Tomato",
      seedQuantity: 5,
      seedUnit: "seed",
    });

    const updated = await updateInventoryPlant(prisma, plant.id, {
      commonName: "Roma Tomato",
      speciesProfileId: cabbage.id,
      seedQuantity: 5,
      seedUnit: "seed",
    });

    expect(updated.speciesProfileId).toBe(cabbage.id);
    expect(updated.speciesProfileName).toBe("Cabbage");
  });
});

describe("seed-equivalent stock (seedsPerUnit)", () => {
  it("stores seedQuantity as canonical seeds while deriving unitQuantity from seedsPerUnit", async () => {
    const plant = await createInventoryPlant(prisma, {
      commonName: "Carrot",
      seedQuantity: 250,
      seedUnit: "packet",
      seedsPerUnit: 125,
    });

    expect(plant.seedQuantity).toBe(250);
    expect(plant.seedsPerUnit).toBe(125);
    expect(plant.unitQuantity).toBe(2);

    const dbRow = await prisma.plant.findUniqueOrThrow({ where: { id: plant.id } });
    expect(dbRow.seedQuantity).toBe(250);
    expect(dbRow.seedsPerUnit).toBe(125);
  });

  it('forces seedsPerUnit to 1 for unit "seed" regardless of client input', async () => {
    const plant = await createInventoryPlant(prisma, {
      commonName: "Kale",
      seedQuantity: 40,
      seedUnit: "seed",
      seedsPerUnit: 99,
    });

    expect(plant.seedsPerUnit).toBe(1);
    expect(plant.unitQuantity).toBe(40);
  });

  it("defaults seedsPerUnit to 1 when a caller omits it entirely (fixture backward compatibility)", async () => {
    const plant = await createInventoryPlant(prisma, {
      commonName: "Basil",
      seedQuantity: 12,
      seedUnit: "seed",
    });

    expect(plant.seedsPerUnit).toBe(1);
  });

  it("decrements canonical seeds correctly when stock is tracked in a purchase unit", async () => {
    const bed = await seedBed(prisma, { name: "Packets", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, {
      commonName: "Onion",
      seedQuantity: 250,
      seedUnit: "packet",
      seedsPerUnit: 125,
    });

    await assignInventoryPlant(prisma, {
      bedId: bed.id,
      column: 1,
      row: 1,
      plantId: plant.id,
      amount: 30,
      mode: "replace",
    });

    const updatedRow = await prisma.plant.findUniqueOrThrow({ where: { id: plant.id } });
    expect(updatedRow.seedQuantity).toBe(220);

    const snapshot = await getInventorySnapshot(prisma);
    const inventoryPlant = snapshot.seeds.find((seed) => seed.id === plant.id);
    expect(inventoryPlant?.unitQuantity).toBeCloseTo(1.76, 2);

    const planting = await prisma.cellPlanting.findFirstOrThrow({ where: { plantId: plant.id } });
    expect(planting).toMatchObject({ seedQuantityUsed: 30, seedUnit: "seed" });
  });
});
