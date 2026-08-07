"use client";

// Proactive, always-visible needs-attention digest — unlike GardenSummary
// (which only renders in the CellPicker's slot when nothing is selected,
// GardenView.tsx), this banner is an unconditional sibling so a stressed or
// infected cell is never more than a glance away regardless of what else is
// selected. Reuses summarizeBed (bed-summary.ts) rather than recomputing
// the same per-bed tallies a second way.
//
// Each flagged cell is its own clickable line (not just a per-bed count) so
// "1 infected cell" is something you can jump straight to, reusing
// GardenView's existing select-and-scroll pipeline (selectCell ->
// pickerPanelRef.scrollIntoView) rather than inventing a second one.

import { AlertTriangle } from "lucide-react";
import type { AttentionCell } from "./bed-summary";
import { summarizeBed } from "./bed-summary";
import { plantName } from "./plant-lookup";
import { FOCUS_RING } from "./ui-constants";
import type { PlantOption, SelectedCell, SnapshotBed } from "./types";

export interface NeedsAttentionBannerProps {
  beds: SnapshotBed[];
  plants: PlantOption[];
  onSelectCell: (target: SelectedCell) => void;
  bare?: boolean;
}

const REASON_LABEL: Record<AttentionCell["reasons"][number], string> = {
  critical: "critically stressed",
  stressed: "stressed",
  infected: "infected",
};

function attentionCellLabel(attention: AttentionCell, plants: PlantOption[]): string {
  const plantLabel = attention.cell.plantIds.length > 0 ? plantName(plants, attention.cell.plantIds[0]) : "Empty cell";
  const reasons = attention.reasons.map((reason) => REASON_LABEL[reason]).join(", ");
  return `Column ${attention.cell.column}, row ${attention.cell.row} · ${plantLabel} — ${reasons}`;
}

export function NeedsAttentionBanner({ beds, plants, onSelectCell, bare = false }: NeedsAttentionBannerProps) {
  const rows = beds
    .map((bed) => ({ bed, stats: summarizeBed(bed) }))
    .filter(({ stats }) => stats.attentionCells.length > 0);

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
      <div className="flex flex-col gap-2.5">
        {rows.map(({ bed, stats }) => (
          <div key={bed.id}>
            <p className="text-sm font-semibold" style={{ color: "var(--color-warning-text)" }}>
              {bed.name}
            </p>
            <ul className="flex flex-col gap-1">
              {stats.attentionCells.map((attention) => (
                <li key={`${attention.cell.column}:${attention.cell.row}`}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectCell({
                        bedId: bed.id,
                        bedName: bed.name,
                        column: attention.cell.column,
                        row: attention.cell.row,
                        status: attention.cell.status,
                        plantIds: attention.cell.plantIds,
                        plantings: attention.cell.plantings,
                        environment: attention.cell.environment,
                        soilProfile: bed.soilProfile,
                      })
                    }
                    className={`rounded text-left text-sm underline decoration-dotted underline-offset-2 hover:decoration-solid ${FOCUS_RING}`}
                    style={{ color: "var(--color-warning-text)" }}
                  >
                    {attentionCellLabel(attention, plants)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Wrapper>
  );
}
