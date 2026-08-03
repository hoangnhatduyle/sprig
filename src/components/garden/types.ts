import type { GardenSnapshot } from "@/domain/grid/grid-cell-service";
import type { GardenJournal, JournalEntryKind } from "@/domain/journal/journal-service";
import type { InventoryPlant } from "@/domain/plant-catalog/inventory-service";

export type { JournalEntryKind };

export type SnapshotBed = GardenSnapshot["beds"][number];
export type SnapshotCell = SnapshotBed["cells"][number];
export type SnapshotEquipment = SnapshotBed["equipment"][number];
export type SnapshotPestPopulation = SnapshotBed["pests"][number];
export type SnapshotPredatorPopulation = SnapshotBed["predators"][number];
export type SnapshotInfection = SnapshotCell["plantings"][number]["infections"][number];
export type SnapshotCompanionEffect = SnapshotCell["plantings"][number]["companionEffects"][number];
export type SnapshotSoilProfile = NonNullable<SnapshotBed["soilProfile"]>;
export type GardenEnvironment = GardenSnapshot["environment"];
export type SnapshotRainBarrel = GardenSnapshot["rainBarrels"][number];
export type JournalEntry = GardenJournal["entries"][number];

export type PlantOption = Pick<InventoryPlant, "id" | "commonName"> &
  Partial<Omit<InventoryPlant, "id" | "commonName">>;

// The picker's target cell, captured as an independent value at click time —
// deliberately NOT a live reference/index into `beds`, so it can't drift if
// the grid data is refreshed or reordered while the picker is still open
// (NC-SPRIG-PLANTUI-NO-STALE-CELL-REF).
export interface SelectedCell {
  bedId: string;
  bedName: string;
  column: number;
  row: number;
  status: SnapshotCell["status"];
  plantIds: string[];
  plantings?: SnapshotCell["plantings"];
  environment?: SnapshotCell["environment"];
  soilProfile?: SnapshotBed["soilProfile"];
}
