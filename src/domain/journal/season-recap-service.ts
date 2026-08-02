// Season Recap (SPEC-JOURNAL-001) — an aggregation pass over getGardenJournal
// for a chosen date range. Deliberately a thin composition layer: no new
// Prisma queries beyond what getGardenJournal already runs, since the point
// is to summarize the Journal, not re-derive it.

import type { PrismaClient } from "@prisma/client";
import { getGardenJournal, type JournalEntryKind } from "./journal-service";

const RECAP_ENTRY_LIMIT = 5000;

export interface SeasonRecapHarvestTotal {
  plantId: string;
  plantName: string;
  amount: number;
  unit: string;
}

export interface SeasonRecapHighlight {
  plantName: string;
  amount: number;
  unit: string;
  bedName: string;
  occurredAt: string;
}

export interface SeasonRecapActiveBed {
  bedId: string;
  bedName: string;
  entryCount: number;
}

export interface SeasonRecap {
  sinceIso: string;
  untilIso: string;
  totalEntries: number;
  entriesByKind: Record<JournalEntryKind, number>;
  harvestTotals: SeasonRecapHarvestTotal[];
  mostActiveBed: SeasonRecapActiveBed | null;
  largestHarvest: SeasonRecapHighlight | null;
  unresolvedDiseaseEpisodes: number;
}

const ZERO_BY_KIND = (): Record<JournalEntryKind, number> => ({
  LIFECYCLE: 0,
  HARVEST: 0,
  CARE_ACTION: 0,
  EQUIPMENT: 0,
  RENOVATION: 0,
  DISEASE: 0,
  NOTE: 0,
});

export async function getSeasonRecap(
  prisma: PrismaClient,
  range: { since: Date; until: Date },
): Promise<SeasonRecap> {
  const journal = await getGardenJournal(prisma, {
    since: range.since,
    until: range.until,
    includeSystemLifecycleEvents: false,
    limit: RECAP_ENTRY_LIMIT,
  });

  const entriesByKind = ZERO_BY_KIND();
  const harvestTotalsByKey = new Map<string, SeasonRecapHarvestTotal>();
  const entryCountByBed = new Map<string, SeasonRecapActiveBed>();
  let largestHarvest: SeasonRecapHighlight | null = null;
  let unresolvedDiseaseEpisodes = 0;

  for (const entry of journal.entries) {
    entriesByKind[entry.kind] += 1;

    const bedTotal = entryCountByBed.get(entry.bedId) ?? { bedId: entry.bedId, bedName: entry.bedName, entryCount: 0 };
    bedTotal.entryCount += 1;
    entryCountByBed.set(entry.bedId, bedTotal);

    if (entry.kind === "HARVEST") {
      const key = `${entry.plantId}:${entry.unit.toLowerCase()}`;
      const total = harvestTotalsByKey.get(key) ?? {
        plantId: entry.plantId,
        plantName: entry.plantName,
        amount: 0,
        unit: entry.unit,
      };
      total.amount += entry.amount;
      harvestTotalsByKey.set(key, total);

      if (!largestHarvest || entry.amount > largestHarvest.amount) {
        largestHarvest = {
          plantName: entry.plantName,
          amount: entry.amount,
          unit: entry.unit,
          bedName: entry.bedName,
          occurredAt: entry.occurredAt,
        };
      }
    }

    if (entry.kind === "DISEASE" && entry.phase === "started") {
      unresolvedDiseaseEpisodes += 1;
    }
    if (entry.kind === "DISEASE" && entry.phase === "resolved") {
      unresolvedDiseaseEpisodes -= 1;
    }
  }

  const mostActiveBed =
    [...entryCountByBed.values()].sort((a, b) => b.entryCount - a.entryCount)[0] ?? null;

  return {
    sinceIso: range.since.toISOString(),
    untilIso: range.until.toISOString(),
    totalEntries: journal.entries.length,
    entriesByKind,
    harvestTotals: [...harvestTotalsByKey.values()].sort((a, b) => b.amount - a.amount),
    mostActiveBed,
    largestHarvest,
    unresolvedDiseaseEpisodes: Math.max(0, unresolvedDiseaseEpisodes),
  };
}
