import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignPlant, seedBed } from "@/domain/grid/grid-cell-service";
import { createTestPrismaClient, resetGridTables } from "@/domain/grid/test-db";
import { createInventoryPlant } from "@/domain/plant-catalog/inventory-service";
import { createJournalNote } from "./journal-note-service";
import { JournalValidationError } from "./errors";

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetGridTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

describe("createJournalNote", () => {
  it("throws when both body and photo are absent", async () => {
    await expect(createJournalNote(prisma, {})).rejects.toBeInstanceOf(JournalValidationError);
  });

  it("succeeds with a body only, garden-wide (no bed)", async () => {
    const note = await createJournalNote(prisma, { body: "First frost warning tonight." });
    expect(note.bedId).toBeNull();
    expect(note.cellId).toBeNull();
    expect(note.body).toBe("First frost warning tonight.");
  });

  it("succeeds with a photo only", async () => {
    const note = await createJournalNote(prisma, { photoFilename: "abc.jpg", photoMimeType: "image/jpeg" });
    expect(note.body).toBeNull();
    expect(note.photoFilename).toBe("abc.jpg");
  });

  it("scopes a note to a bed without a specific cell", async () => {
    const bed = await seedBed(prisma, { name: "Note Bed", compassPosition: "SOUTH" });
    const note = await createJournalNote(prisma, { bedId: bed.id, body: "Soil looks dry." });
    expect(note.bedId).toBe(bed.id);
    expect(note.cellId).toBeNull();
  });

  it("scopes a note to a specific cell, resolving cellId from bedId+column+row", async () => {
    const bed = await seedBed(prisma, { name: "Cell Note Bed", compassPosition: "SOUTH" });
    const plant = await createInventoryPlant(prisma, { commonName: "Kale", seedQuantity: 3, seedUnit: "seed" });
    await assignPlant(prisma, { bedId: bed.id, column: 1, row: 1, plantId: plant.id });
    const cell = await prisma.gridCell.findFirstOrThrow({ where: { bedId: bed.id, column: 1, row: 1 } });

    const note = await createJournalNote(prisma, { bedId: bed.id, column: 1, row: 1, body: "Aphids spotted." });
    expect(note.cellId).toBe(cell.id);
  });

  it("rejects cell coordinates given without a bedId", async () => {
    await expect(createJournalNote(prisma, { column: 1, row: 1, body: "Orphan note" })).rejects.toBeInstanceOf(
      JournalValidationError,
    );
  });
});
