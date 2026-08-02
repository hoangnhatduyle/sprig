import type { PrismaClient } from "@prisma/client";
import { resolveSpeciesProfileForName } from "@/domain/growth/species-catalog";

export interface InventoryPlant {
  id: string;
  commonName: string;
  species: string | null;
  waterNeed: string | null;
  lightNeed: string | null;
  isCompanionPlanting: boolean;
  notes: string | null;
  seedQuantity: number;
  seedUnit: string;
  imageUrl: string | null;
}

export interface YieldEntry {
  id: string;
  plantId: string;
  plantName: string;
  amount: number;
  unit: string;
  harvestedAt: string;
  notes: string | null;
  bedName: string;
  column: number;
  row: number;
}

export interface InventorySnapshot {
  seeds: InventoryPlant[];
  yields: YieldEntry[];
}

export interface PlantInput {
  commonName: string;
  species?: string | null;
  waterNeed?: string | null;
  lightNeed?: string | null;
  isCompanionPlanting?: boolean;
  notes?: string | null;
  seedQuantity: number;
  seedUnit: string;
}

export class InventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryValidationError";
  }
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new InventoryValidationError(`${label} is required.`);
  return trimmed;
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function validatePlantInput(input: PlantInput): PlantInput {
  if (!Number.isFinite(input.seedQuantity) || input.seedQuantity < 0) {
    throw new InventoryValidationError("Seed quantity must be zero or greater.");
  }
  return {
    ...input,
    commonName: requiredText(input.commonName, "Plant name"),
    seedUnit: requiredText(input.seedUnit, "Seed unit"),
    species: optionalText(input.species),
    waterNeed: optionalText(input.waterNeed),
    lightNeed: optionalText(input.lightNeed),
    notes: optionalText(input.notes),
  };
}

function plantDto(plant: {
  id: string;
  commonName: string;
  species: string | null;
  waterNeed: string | null;
  lightNeed: string | null;
  isCompanionPlanting: boolean;
  notes: string | null;
  seedQuantity: number;
  seedUnit: string;
  imageFilename: string | null;
}): InventoryPlant {
  return {
    ...plant,
    imageUrl: plant.imageFilename ? `/api/plant-images/${plant.id}` : null,
  };
}

export async function getInventorySnapshot(prisma: PrismaClient): Promise<InventorySnapshot> {
  const [plants, harvests] = await Promise.all([
    prisma.plant.findMany({
      where: { archivedAt: null },
      orderBy: { commonName: "asc" },
    }),
    prisma.harvestRecord.findMany({
      orderBy: { harvestedAt: "desc" },
      include: {
        plant: { select: { commonName: true } },
        cellPlanting: {
          include: { cell: { include: { bed: { select: { name: true } } } } },
        },
      },
    }),
  ]);

  return {
    seeds: plants.map(plantDto),
    yields: harvests.map((record) => ({
      id: record.id,
      plantId: record.plantId,
      plantName: record.plant.commonName,
      amount: record.amount,
      unit: record.unit,
      harvestedAt: record.harvestedAt.toISOString(),
      notes: record.notes,
      bedName: record.cellPlanting.cell.bed.name,
      column: record.cellPlanting.cell.column,
      row: record.cellPlanting.cell.row,
    })),
  };
}

// Resolves the free-typed commonName to a SpeciesProfile via the keyword
// heuristic (falling back to the generic archetype for anything
// unrecognized) so every catalog entry has a growth model and a procedural
// visual to render from the moment it's created — see the architecture
// doc's §16. Never blocks plant creation on this: growth-catalog seeding is
// self-healing (species-catalog.ts), so this can't fail in a way that
// should also fail the plant creation itself.
async function resolveSpeciesProfileId(prisma: PrismaClient, commonName: string): Promise<string> {
  const species = await resolveSpeciesProfileForName(prisma, commonName);
  return species.id;
}

export async function createInventoryPlant(
  prisma: PrismaClient,
  rawInput: PlantInput,
): Promise<InventoryPlant> {
  const input = validatePlantInput(rawInput);
  const speciesProfileId = await resolveSpeciesProfileId(prisma, input.commonName);
  const plant = await prisma.plant.create({ data: { ...input, speciesProfileId } });
  return plantDto(plant);
}

export async function updateInventoryPlant(
  prisma: PrismaClient,
  id: string,
  rawInput: PlantInput,
): Promise<InventoryPlant> {
  const input = validatePlantInput(rawInput);
  const speciesProfileId = await resolveSpeciesProfileId(prisma, input.commonName);
  const plant = await prisma.plant.update({
    where: { id },
    data: { ...input, speciesProfileId },
  });
  return plantDto(plant);
}

export async function deleteInventoryPlant(prisma: PrismaClient, id: string): Promise<"deleted" | "archived"> {
  return prisma.$transaction(async (tx) => {
    const [plantings, events, harvests] = await Promise.all([
      tx.cellPlanting.count({ where: { plantId: id } }),
      tx.gridCellEvent.count({ where: { plantId: id } }),
      tx.harvestRecord.count({ where: { plantId: id } }),
    ]);
    if (plantings + events + harvests > 0) {
      await tx.plant.update({ where: { id }, data: { archivedAt: new Date() } });
      return "archived";
    }
    await tx.plant.delete({ where: { id } });
    return "deleted";
  });
}

export async function updatePlantImageMetadata(
  prisma: PrismaClient,
  id: string,
  imageFilename: string,
  imageMimeType: string,
): Promise<string | null> {
  const previous = await prisma.plant.findUniqueOrThrow({
    where: { id },
    select: { imageFilename: true },
  });
  await prisma.plant.update({
    where: { id },
    data: { imageFilename, imageMimeType },
  });
  return previous.imageFilename;
}
