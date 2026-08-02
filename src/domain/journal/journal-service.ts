// Garden Journal read model (SPEC-JOURNAL-001) — merges every durable
// record of "what happened in the real garden" into one chronological feed.
// Follows the same (prisma, options?) => Promise<Shape> read-model
// convention as getGardenSnapshot (src/domain/grid/grid-cell-service.ts) and
// getInventorySnapshot (src/domain/plant-catalog/inventory-service.ts) —
// the latter's Promise.all([plant.findMany, harvestRecord.findMany]) +
// flat-DTO-mapping pattern is generalized here across seven source tables.
//
// This module only reads. It never writes GridCellEvent/HarvestRecord/
// CareActionEvent/BedConditionOverride/BedRenovation/DiseaseInfection —
// those are all written from their own domain services (grid-cell-service,
// care-actions-service, disease-action-service, pest-action-service,
// bed-condition-override-service) at the moment the real action happens.
// JournalNote is the one exception with its own dedicated write path
// (journal-note-service.ts), since it has no other "action" to piggyback on.

import type { CareActionType, CellStatus, ConditionOverrideKind, PrismaClient } from "@prisma/client";

export type JournalEntryKind =
  | "LIFECYCLE"
  | "HARVEST"
  | "CARE_ACTION"
  | "EQUIPMENT"
  | "RENOVATION"
  | "DISEASE"
  | "NOTE";

// Kinds where filtering by plantId is meaningful — CareActionEvent,
// BedConditionOverride, BedRenovation, and JournalNote have no plant
// association at all, so a plantId filter simply excludes them rather than
// erroring.
const PLANT_ASSOCIATED_KINDS: ReadonlySet<JournalEntryKind> = new Set(["LIFECYCLE", "HARVEST", "DISEASE"]);

// GERMINATED/GROWING GridCellEvent rows are only ever written by
// syncCellStatusFromPhenology in catch-up-service.ts (the daily auto-advance
// step), never from a user-triggered action.ts call — see
// src/domain/grid/grid-cell-service.ts's germinate()/grow(), which carry a
// comment cross-referencing this heuristic. If a future change ever calls
// those from a new user-triggered path, this set must be updated too.
const SYSTEM_DRIVEN_LIFECYCLE_EVENT_TYPES: ReadonlySet<CellStatus> = new Set(["GERMINATED", "GROWING"]);

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

interface JournalEntryBase {
  id: string;
  occurredAt: string; // ISO
  bedId: string;
  bedName: string;
  column: number | null;
  row: number | null;
}

export type LifecycleJournalEntry = JournalEntryBase & {
  kind: "LIFECYCLE";
  eventType: CellStatus;
  plantId: string | null;
  plantName: string | null;
  note: string | null;
  source: "system" | "user";
};

export type HarvestJournalEntry = JournalEntryBase & {
  kind: "HARVEST";
  plantId: string;
  plantName: string;
  amount: number;
  unit: string;
  notes: string | null;
};

export type CareActionJournalEntry = JournalEntryBase & {
  kind: "CARE_ACTION";
  actionType: CareActionType;
  detail: Record<string, unknown> | null;
};

export type EquipmentJournalEntry = JournalEntryBase & {
  kind: "EQUIPMENT";
  equipmentKind: ConditionOverrideKind;
  phase: "installed" | "removed";
};

export type RenovationJournalEntry = JournalEntryBase & {
  kind: "RENOVATION";
  note: string;
  previousCols: number;
  previousRows: number;
  newCols: number;
  newRows: number;
};

export type DiseaseJournalEntry = JournalEntryBase & {
  kind: "DISEASE";
  plantId: string;
  plantName: string;
  diseaseKey: string;
  phase: "started" | "resolved";
  severity: number;
};

export type NoteJournalEntry = JournalEntryBase & {
  kind: "NOTE";
  body: string | null;
  photoUrl: string | null;
};

export type JournalEntry =
  | LifecycleJournalEntry
  | HarvestJournalEntry
  | CareActionJournalEntry
  | EquipmentJournalEntry
  | RenovationJournalEntry
  | DiseaseJournalEntry
  | NoteJournalEntry;

export interface GetGardenJournalOptions {
  bedId?: string;
  cellId?: string;
  plantId?: string;
  kinds?: JournalEntryKind[];
  /** Default false — keeps the default feed signal-dense (a user's actions,
   *  not routine engine-driven stage advances). Surfaced in the UI as a
   *  "Show automatic growth updates" toggle. */
  includeSystemLifecycleEvents?: boolean;
  since?: Date;
  until?: Date;
  /** Default 100, clamped to 500. */
  limit?: number;
  offset?: number;
}

export interface GardenJournal {
  entries: JournalEntry[];
  hasMore: boolean;
}

function parseDetail(detail: string | null): Record<string, unknown> | null {
  if (!detail) return null;
  try {
    return JSON.parse(detail) as Record<string, unknown>;
  } catch {
    // Written by our own care-action services, never user input — but a
    // read model should never throw over a malformed row it didn't create.
    return null;
  }
}

export async function getGardenJournal(
  prisma: PrismaClient,
  options: GetGardenJournalOptions = {},
): Promise<GardenJournal> {
  const kindsFilter = options.kinds
    ? new Set(options.kinds)
    : null;
  const wantsKind = (kind: JournalEntryKind): boolean => {
    if (kindsFilter && !kindsFilter.has(kind)) return false;
    if (options.plantId && !PLANT_ASSOCIATED_KINDS.has(kind)) return false;
    return true;
  };

  const cellFilter = options.cellId ? { id: options.cellId } : options.bedId ? { bedId: options.bedId } : undefined;
  const bedFilter = options.bedId ? { bedId: options.bedId } : undefined;

  const [lifecycleRows, harvestRows, careActionRows, equipmentRows, renovationRows, diseaseRows, noteRows] =
    await Promise.all([
      wantsKind("LIFECYCLE")
        ? prisma.gridCellEvent.findMany({
            where: { cell: cellFilter, plantId: options.plantId },
            include: { cell: { include: { bed: { select: { name: true } } } }, plant: { select: { commonName: true } } },
          })
        : Promise.resolve([]),
      wantsKind("HARVEST")
        ? prisma.harvestRecord.findMany({
            where: { plantId: options.plantId, cellPlanting: { cell: cellFilter } },
            include: {
              plant: { select: { commonName: true } },
              cellPlanting: { include: { cell: { include: { bed: { select: { name: true } } } } } },
            },
          })
        : Promise.resolve([]),
      wantsKind("CARE_ACTION")
        ? prisma.careActionEvent.findMany({
            where: { bedId: options.bedId, cellId: options.cellId },
            include: { bed: { select: { name: true } }, cell: { select: { column: true, row: true } } },
          })
        : Promise.resolve([]),
      wantsKind("EQUIPMENT")
        ? prisma.bedConditionOverride.findMany({
            where: bedFilter,
            include: { bed: { select: { name: true } } },
          })
        : Promise.resolve([]),
      wantsKind("RENOVATION")
        ? prisma.bedRenovation.findMany({
            where: bedFilter,
            include: { bed: { select: { name: true } } },
          })
        : Promise.resolve([]),
      wantsKind("DISEASE")
        ? prisma.diseaseInfection.findMany({
            where: { cellPlanting: { plantId: options.plantId, cell: cellFilter } },
            include: {
              cellPlanting: {
                include: { plant: { select: { commonName: true } }, cell: { include: { bed: { select: { name: true } } } } },
              },
            },
          })
        : Promise.resolve([]),
      wantsKind("NOTE")
        ? prisma.journalNote.findMany({
            where: { bedId: options.bedId, cellId: options.cellId },
            include: {
              bed: { select: { name: true } },
              cell: { select: { bedId: true, column: true, row: true, bed: { select: { name: true } } } },
            },
          })
        : Promise.resolve([]),
    ]);

  const entries: JournalEntry[] = [];

  for (const row of lifecycleRows) {
    const source: "system" | "user" = SYSTEM_DRIVEN_LIFECYCLE_EVENT_TYPES.has(row.eventType) ? "system" : "user";
    if (source === "system" && !options.includeSystemLifecycleEvents) continue;
    entries.push({
      kind: "LIFECYCLE",
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      bedId: row.cell.bedId,
      bedName: row.cell.bed.name,
      column: row.cell.column,
      row: row.cell.row,
      eventType: row.eventType,
      plantId: row.plantId,
      plantName: row.plant?.commonName ?? null,
      note: row.note,
      source,
    });
  }

  for (const row of harvestRows) {
    entries.push({
      kind: "HARVEST",
      id: row.id,
      occurredAt: row.harvestedAt.toISOString(),
      bedId: row.cellPlanting.cell.bedId,
      bedName: row.cellPlanting.cell.bed.name,
      column: row.cellPlanting.cell.column,
      row: row.cellPlanting.cell.row,
      plantId: row.plantId,
      plantName: row.plant.commonName,
      amount: row.amount,
      unit: row.unit,
      notes: row.notes,
    });
  }

  for (const row of careActionRows) {
    entries.push({
      kind: "CARE_ACTION",
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      bedId: row.bedId,
      bedName: row.bed.name,
      column: row.cell?.column ?? null,
      row: row.cell?.row ?? null,
      actionType: row.actionType,
      detail: parseDetail(row.detail),
    });
  }

  for (const row of equipmentRows) {
    entries.push({
      kind: "EQUIPMENT",
      id: `${row.id}:installed`,
      occurredAt: row.installedAt.toISOString(),
      bedId: row.bedId,
      bedName: row.bed.name,
      column: null,
      row: null,
      equipmentKind: row.kind,
      phase: "installed",
    });
    if (row.removedAt) {
      entries.push({
        kind: "EQUIPMENT",
        id: `${row.id}:removed`,
        occurredAt: row.removedAt.toISOString(),
        bedId: row.bedId,
        bedName: row.bed.name,
        column: null,
        row: null,
        equipmentKind: row.kind,
        phase: "removed",
      });
    }
  }

  for (const row of renovationRows) {
    entries.push({
      kind: "RENOVATION",
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      bedId: row.bedId,
      bedName: row.bed.name,
      column: null,
      row: null,
      note: row.note,
      previousCols: row.previousCols,
      previousRows: row.previousRows,
      newCols: row.newCols,
      newRows: row.newRows,
    });
  }

  for (const row of diseaseRows) {
    const base = {
      bedId: row.cellPlanting.cell.bedId,
      bedName: row.cellPlanting.cell.bed.name,
      column: row.cellPlanting.cell.column,
      row: row.cellPlanting.cell.row,
      plantId: row.cellPlanting.plantId,
      plantName: row.cellPlanting.plant.commonName,
      diseaseKey: row.diseaseKey,
    } as const;
    entries.push({
      kind: "DISEASE",
      id: `${row.id}:started`,
      occurredAt: row.startedAt.toISOString(),
      phase: "started",
      severity: row.severity,
      ...base,
    });
    if (row.resolvedAt) {
      entries.push({
        kind: "DISEASE",
        id: `${row.id}:resolved`,
        occurredAt: row.resolvedAt.toISOString(),
        phase: "resolved",
        severity: row.severity,
        ...base,
      });
    }
  }

  for (const row of noteRows) {
    entries.push({
      kind: "NOTE",
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      bedId: row.bedId ?? row.cell?.bedId ?? "",
      bedName: row.bed?.name ?? row.cell?.bed.name ?? "",
      column: row.cell?.column ?? null,
      row: row.cell?.row ?? null,
      body: row.body,
      photoUrl: row.photoFilename ? `/api/journal-photos/${row.id}` : null,
    });
  }

  const since = options.since?.getTime();
  const until = options.until?.getTime();
  const filtered = entries.filter((entry) => {
    const at = new Date(entry.occurredAt).getTime();
    if (since !== undefined && at < since) return false;
    if (until !== undefined && at > until) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const delta = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    return delta !== 0 ? delta : b.id.localeCompare(a.id);
  });

  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = options.offset ?? 0;
  const page = filtered.slice(offset, offset + limit);

  return { entries: page, hasMore: filtered.length > offset + limit };
}
