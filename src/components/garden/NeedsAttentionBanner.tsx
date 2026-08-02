"use client";

// Proactive, always-visible needs-attention digest — unlike GardenSummary
// (which only renders in the CellPicker's slot when nothing is selected,
// GardenView.tsx), this banner is an unconditional sibling so a stressed or
// infected cell is never more than a glance away regardless of what else is
// selected. Reuses summarizeBed (bed-summary.ts) rather than recomputing
// the same per-bed tallies a second way.

import { AlertTriangle } from "lucide-react";
import { summarizeBed } from "./bed-summary";
import type { SnapshotBed } from "./types";

export interface NeedsAttentionBannerProps {
  beds: SnapshotBed[];
  bare?: boolean;
}

export function NeedsAttentionBanner({ beds, bare = false }: NeedsAttentionBannerProps) {
  const rows = beds
    .map((bed) => ({ bed, stats: summarizeBed(bed) }))
    .filter(({ stats }) => stats.stressedCells + stats.criticalCells + stats.infectedCells > 0);

  if (rows.length === 0) {
    return null;
  }

  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper
      aria-label="Needs attention"
      className={bare ? "flex flex-col gap-2" : "flex flex-col gap-2 rounded-xl border p-3 sm:p-4"}
      style={
        bare
          ? undefined
          : { borderColor: "var(--color-danger-text)", background: "var(--color-warning-bg)" }
      }
    >
      <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--color-warning-text)" }}>
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
        Needs attention
      </p>
      <ul className="flex flex-col gap-1">
        {rows.map(({ bed, stats }) => {
          const needsAttention = stats.stressedCells + stats.criticalCells;
          const parts: string[] = [];
          if (needsAttention > 0) {
            parts.push(
              `${needsAttention} cell${needsAttention === 1 ? "" : "s"} stressed${stats.criticalCells > 0 ? ` (${stats.criticalCells} critical)` : ""}`,
            );
          }
          if (stats.infectedCells > 0) {
            parts.push(`${stats.infectedCells} infected cell${stats.infectedCells === 1 ? "" : "s"}`);
          }
          return (
            <li key={bed.id} className="text-sm" style={{ color: "var(--color-warning-text)" }}>
              <strong>{bed.name}:</strong> {parts.join(" · ")}
            </li>
          );
        })}
      </ul>
    </Wrapper>
  );
}
