// Yield-over-time read model for the Trends tab. Deliberately queries
// HarvestRecord directly rather than delegating to getGardenJournal (the
// pattern season-recap-service.ts uses) — getGardenJournal hard-caps at
// MAX_LIMIT (500) entries after an in-memory sort, which silently drops data
// for a season with more harvests than that. A day-by-day trend chart can't
// tolerate that kind of silent truncation, so this reads HarvestRecord
// straight, scoped by the same since/until/bedId/plantId filters.

import type { PrismaClient } from "@prisma/client";

export interface YieldTrendUnitTotal {
  unit: string;
  amount: number;
}

export interface YieldTrendPoint {
  dateIso: string; // UTC day, e.g. "2026-06-01"
  totalsByUnit: YieldTrendUnitTotal[];
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getYieldTrend(
  prisma: PrismaClient,
  range: { since: Date; until: Date; bedId?: string; plantId?: string },
): Promise<YieldTrendPoint[]> {
  const rows = await prisma.harvestRecord.findMany({
    where: {
      plantId: range.plantId,
      harvestedAt: { gte: range.since, lte: range.until },
      cellPlanting: range.bedId ? { cell: { bedId: range.bedId } } : undefined,
    },
    select: { amount: true, unit: true, harvestedAt: true },
    orderBy: { harvestedAt: "asc" },
  });

  const totalsByDay = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const dateKey = utcDateKey(row.harvestedAt);
    const byUnit = totalsByDay.get(dateKey) ?? new Map<string, number>();
    byUnit.set(row.unit, (byUnit.get(row.unit) ?? 0) + row.amount);
    totalsByDay.set(dateKey, byUnit);
  }

  return [...totalsByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateIso, byUnit]) => ({
      dateIso,
      totalsByUnit: [...byUnit.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([unit, amount]) => ({ unit, amount })),
    }));
}
