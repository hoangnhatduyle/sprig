import type { PrismaClient } from "@prisma/client";
import { resolveSpeciesProfileForName } from "@/domain/growth/species-catalog";
import { isSeedUnit } from "./seed-units";

export interface InventoryPlant {
  id: string;
  commonName: string;
  waterNeed: string | null;
  lightNeed: string | null;
  isCompanionPlanting: boolean;
  notes: string | null;
  seedQuantity: number;
  seedUnit: string;
  seedsPerUnit: number;
  // Derived display quantity in seedUnit terms (seedQuantity for unit
  // "seed"; seedQuantity / seedsPerUnit otherwise) — seedQuantity itself is
  // always canonical seed-equivalents, never the purchase-unit count.
  unitQuantity: number;
  imageUrl: string | null;
  speciesProfileId: string | null;
  speciesProfileName: string | null;
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
  // Sticky when provided — resolveSpeciesProfileId never re-derives an
  // explicitly supplied id. Optional at this domain-function level only for
  // fixture call sites in other tests; actions.ts enforces it as required
  // for the real caller (InventoryPanel.tsx).
  speciesProfileId?: string | null;
  waterNeed?: string | null;
  lightNeed?: string | null;
  isCompanionPlanting?: boolean;
  notes?: string | null;
  seedQuantity: number;
  seedUnit: string;
  // Optional so fixture call sites across the codebase (season-reset-
  // service.test.ts and friends) that predate this field keep compiling —
  // defaults to 1, exactly backward-compatible with pre-seedsPerUnit
  // behavior (see schema.prisma's column default and §5 of the plan).
  seedsPerUnit?: number;
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function validatePlantInput(input: PlantInput): PlantInput {
  if (!Number.isFinite(input.seedQuantity) || input.seedQuantity < 0) {
    throw new InventoryValidationError("Seed quantity must be zero or greater.");
  }
  if (!isSeedUnit(input.seedUnit)) {
    throw new InventoryValidationError("Seed unit is not recognized.");
  }
  const seedsPerUnit = input.seedsPerUnit ?? 1;
  if (!Number.isFinite(seedsPerUnit) || seedsPerUnit <= 0) {
    throw new InventoryValidationError("Seeds per unit must be greater than zero.");
  }
  return {
    ...input,
    commonName: requiredText(input.commonName, "Plant name"),
    seedUnit: requiredText(input.seedUnit, "Seed unit"),
    // Seed is definitionally the atomic unit — never trust client input to
    // set a conversion factor away from 1 for it (defense in depth; the UI
    // also locks this field for unit "seed").
    seedsPerUnit: input.seedUnit === "seed" ? 1 : seedsPerUnit,
    waterNeed: optionalText(input.waterNeed),
    lightNeed: optionalText(input.lightNeed),
    notes: optionalText(input.notes),
  };
}

function plantDto(plant: {
  id: string;
  commonName: string;
  waterNeed: string | null;
  lightNeed: string | null;
  isCompanionPlanting: boolean;
  notes: string | null;
  seedQuantity: number;
  seedUnit: string;
  seedsPerUnit: number;
  imageFilename: string | null;
  speciesProfile: { id: string; displayName: string } | null;
}): InventoryPlant {
  const { speciesProfile, imageFilename, ...rest } = plant;
  return {
    ...rest,
    imageUrl: imageFilename ? `/api/plant-images/${plant.id}` : null,
    speciesProfileId: speciesProfile?.id ?? null,
    speciesProfileName: speciesProfile?.displayName ?? null,
    unitQuantity:
      plant.seedUnit === "seed" ? plant.seedQuantity : round2(plant.seedQuantity / plant.seedsPerUnit),
  };
}

const SPECIES_PROFILE_INCLUDE = {
  speciesProfile: { select: { id: true, displayName: true } },
} as const;

export async function getInventorySnapshot(prisma: PrismaClient): Promise<InventorySnapshot> {
  const [plants, harvests] = await Promise.all([
    prisma.plant.findMany({
      where: { archivedAt: null },
      orderBy: { commonName: "asc" },
      include: SPECIES_PROFILE_INCLUDE,
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

// Resolves speciesProfileId for a save. When the caller (the species
// picker, via actions.ts) explicitly supplies one, it's used as-is and
// never re-derived — this is what makes speciesProfileId sticky across
// edits instead of being silently re-guessed every time commonName is
// saved. Only falls back to the free-text keyword heuristic when no id is
// supplied, which keeps every existing fixture call site across the
// codebase (season-reset-service.test.ts, disease-action-service.test.ts,
// etc.) working unmodified. Never blocks plant creation on this:
// growth-catalog seeding is self-healing (species-catalog.ts), so this
// can't fail in a way that should also fail the plant creation itself.
async function resolveSpeciesProfileId(
  prisma: PrismaClient,
  commonName: string,
  speciesProfileId?: string | null,
): Promise<string> {
  if (speciesProfileId) {
    return speciesProfileId;
  }
  const species = await resolveSpeciesProfileForName(prisma, commonName);
  return species.id;
}

export async function createInventoryPlant(
  prisma: PrismaClient,
  rawInput: PlantInput,
): Promise<InventoryPlant> {
  const input = validatePlantInput(rawInput);
  const speciesProfileId = await resolveSpeciesProfileId(prisma, input.commonName, input.speciesProfileId);
  const plant = await prisma.plant.create({
    data: { ...input, speciesProfileId },
    include: SPECIES_PROFILE_INCLUDE,
  });
  return plantDto(plant);
}

export async function updateInventoryPlant(
  prisma: PrismaClient,
  id: string,
  rawInput: PlantInput,
): Promise<InventoryPlant> {
  const input = validatePlantInput(rawInput);
  const speciesProfileId = await resolveSpeciesProfileId(prisma, input.commonName, input.speciesProfileId);
  const plant = await prisma.plant.update({
    where: { id },
    data: { ...input, speciesProfileId },
    include: SPECIES_PROFILE_INCLUDE,
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
