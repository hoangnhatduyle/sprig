// Shared pure per-bed summarization — extracted from GardenSummary.tsx so
// NeedsAttentionBanner (an always-visible digest, unlike GardenSummary's
// conditional-on-no-selection render) can reuse the exact same "how many
// cells need attention" computation without duplicating it. Same
// one-file-per-domain-concern convention as stress-display.ts/pest-display.ts.

import { healthBand } from "./stress-display";
import { MIN_DISPLAY_POPULATION, MIN_DISPLAY_SEVERITY } from "./pest-display";
import type { SnapshotBed, SnapshotCell } from "./types";

export interface BedStats {
  bed: SnapshotBed;
  filledCells: number;
  statusCounts: Partial<Record<SnapshotCell["status"], number>>;
  plantCounts: { plantId: string; count: number }[];
  stressedCells: number;
  criticalCells: number;
  infectedCells: number;
  dominantPestKey: string | null;
  dominantPredatorKey: string | null;
}

// One pass per bed: how full it is, how its cells split across lifecycle
// status, which plants occupy it, and how many need attention right now
// (SPEC-SURFACE-001) — the things the empty-selection gap should answer at
// a glance instead of showing nothing.
export function summarizeBed(bed: SnapshotBed): BedStats {
  const statusCounts: Partial<Record<SnapshotCell["status"], number>> = {};
  const plantOccurrences = new Map<string, number>();
  let filledCells = 0;
  let stressedCells = 0;
  let criticalCells = 0;
  let infectedCells = 0;

  for (const cell of bed.cells) {
    statusCounts[cell.status] = (statusCounts[cell.status] ?? 0) + 1;
    if (cell.plantIds.length > 0) {
      filledCells += 1;
      for (const id of cell.plantIds) {
        plantOccurrences.set(id, (plantOccurrences.get(id) ?? 0) + 1);
      }
    }
    const growth = cell.plantings[0]?.growth ?? null;
    if (growth) {
      const band = healthBand(growth);
      if (band === "critical") criticalCells += 1;
      else if (band === "stressed") stressedCells += 1;
    }
    if (cell.plantings.some((planting) => planting.infections.some((infection) => infection.severity >= MIN_DISPLAY_SEVERITY))) {
      infectedCells += 1;
    }
  }

  const plantCounts = [...plantOccurrences.entries()]
    .map(([plantId, count]) => ({ plantId, count }))
    .sort((a, b) => b.count - a.count);

  const dominantPest = bed.pests
    .filter((pest) => pest.population >= MIN_DISPLAY_POPULATION)
    .sort((a, b) => b.population - a.population)[0];
  const dominantPredator = bed.predators
    .filter((predator) => predator.population >= MIN_DISPLAY_POPULATION)
    .sort((a, b) => b.population - a.population)[0];

  return {
    bed,
    filledCells,
    statusCounts,
    plantCounts,
    stressedCells,
    criticalCells,
    infectedCells,
    dominantPestKey: dominantPest?.pestKey ?? null,
    dominantPredatorKey: dominantPredator?.predatorKey ?? null,
  };
}
