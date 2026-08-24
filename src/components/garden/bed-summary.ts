// Shared pure per-bed summarization — extracted from GardenSummary.tsx so
// NeedsAttentionBanner (an always-visible digest, unlike GardenSummary's
// conditional-on-no-selection render) can reuse the exact same "how many
// cells need attention" computation without duplicating it. Same
// one-file-per-domain-concern convention as stress-display.ts/pest-display.ts.

import { healthBand, STRESS_DIAL_LABEL } from "./stress-display";
import { MIN_DISPLAY_POPULATION, MIN_DISPLAY_SEVERITY } from "./pest-display";
import { isDialActionable } from "./remedy-guidance";
import type { SnapshotBed, SnapshotCell } from "./types";

// One flagged cell plus why it was flagged — lets a caller like
// NeedsAttentionBanner link straight to the specific cell instead of only
// reporting a per-bed count (SPEC-SURFACE banner previously had no way to
// say *which* cell needed attention).
export interface AttentionCell {
  cell: SnapshotCell;
  reasons: ("stressed" | "critical" | "infected")[];
  // Carried straight from the growth engine's own dominant-dial read
  // (stress-service.ts, via SnapshotCell.plantings[0].growth) so a caller
  // like NeedsAttentionBanner/RemedyDialog can say *why* a cell is flagged
  // without re-deriving it — same value CellPicker's StressBadge shows.
  dominantStressDial: string | null;
  // Whether this cell has a currently-active disease infection above the
  // same MIN_DISPLAY_SEVERITY threshold used for the "infected" reason
  // below — remedy-guidance.ts needs this to tell a pestDisease dial's
  // disease-driven case (fungicide) apart from its pest-pressure-only case
  // (no per-cell fix), since the dial itself can't disambiguate the two.
  hasActiveInfection: boolean;
}

export interface BedStats {
  bed: SnapshotBed;
  filledCells: number;
  statusCounts: Partial<Record<SnapshotCell["status"], number>>;
  plantCounts: { plantId: string; count: number }[];
  stressedCells: number;
  criticalCells: number;
  infectedCells: number;
  attentionCells: AttentionCell[];
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
  const attentionCells: AttentionCell[] = [];

  for (const cell of bed.cells) {
    statusCounts[cell.status] = (statusCounts[cell.status] ?? 0) + 1;
    if (cell.plantIds.length > 0) {
      filledCells += 1;
      for (const id of cell.plantIds) {
        plantOccurrences.set(id, (plantOccurrences.get(id) ?? 0) + 1);
      }
    }
    const reasons: AttentionCell["reasons"] = [];
    const growth = cell.plantings[0]?.growth ?? null;
    if (growth) {
      const band = healthBand(growth);
      if (band === "critical") {
        criticalCells += 1;
        reasons.push("critical");
      } else if (band === "stressed") {
        stressedCells += 1;
        reasons.push("stressed");
      }
    }
    const hasActiveInfection = cell.plantings.some((planting) =>
      planting.infections.some((infection) => infection.severity >= MIN_DISPLAY_SEVERITY),
    );
    if (hasActiveInfection) {
      infectedCells += 1;
      reasons.push("infected");
    }
    if (reasons.length > 0) {
      attentionCells.push({
        cell,
        reasons,
        dominantStressDial: growth?.dominantStressDial ?? null,
        hasActiveInfection,
      });
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
    attentionCells,
    dominantPestKey: dominantPest?.pestKey ?? null,
    dominantPredatorKey: dominantPredator?.predatorKey ?? null,
  };
}

// One cause-cluster within a bed's attentionCells — lets NeedsAttentionBanner
// collapse "23 cosmos cells, each its own line" into one "Drought stress
// (23)" heading with the individual cells still listed (and clickable)
// underneath, instead of a flat 60-line list with no structure.
export interface AttentionCellGroup {
  key: string;
  label: string;
  // True when at least one cell in the group has an in-app remedy
  // (remedy-guidance.ts) — pestDisease groups can genuinely mix infected
  // cells (fungicide available) with pest-pressure-only ones (none), so
  // this is "worth checking", not "every cell here is one click away".
  actionable: boolean;
  cells: AttentionCell[];
}

// Preserves each cell's first-occurrence (row-major) order within its group
// rather than re-sorting — grouping is purely a display collapse, not a
// priority ranking.
export function groupAttentionCells(attentionCells: AttentionCell[]): AttentionCellGroup[] {
  const order: string[] = [];
  const groups = new Map<string, AttentionCell[]>();
  for (const attention of attentionCells) {
    const key = attention.dominantStressDial ?? (attention.reasons.includes("infected") ? "infected" : "other");
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(attention);
    } else {
      groups.set(key, [attention]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const cells = groups.get(key) ?? [];
    const label = STRESS_DIAL_LABEL[key] ?? (key === "infected" ? "Infected" : "Needs attention");
    const actionable = cells.some((attention) => isDialActionable(key, attention.hasActiveInfection));
    return { key, label, actionable, cells };
  });
}
