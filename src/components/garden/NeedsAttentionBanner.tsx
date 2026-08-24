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

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Wrench } from "lucide-react";
import type { AttentionCell } from "./bed-summary";
import { groupAttentionCells, summarizeBed } from "./bed-summary";
import { plantName } from "./plant-lookup";
import { RemedyDialog, type RemedyDialogTarget } from "./RemedyDialog";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import type { PlantOption, SelectedCell, SnapshotBed } from "./types";

export interface NeedsAttentionBannerProps {
  beds: SnapshotBed[];
  plants: PlantOption[];
  onSelectCell: (target: SelectedCell) => void;
  onRefresh: () => Promise<void>;
  onOpenIrrigationSettings: () => void;
  bare?: boolean;
}

const REASON_LABEL: Record<AttentionCell["reasons"][number], string> = {
  critical: "critically stressed",
  stressed: "stressed",
  infected: "infected",
};

function attentionCellLabel(
  attention: AttentionCell,
  plants: PlantOption[],
): string {
  const plantLabel =
    attention.cell.plantIds.length > 0
      ? plantName(plants, attention.cell.plantIds[0])
      : "Empty cell";
  const reasons = attention.reasons
    .map((reason) => REASON_LABEL[reason])
    .join(", ");
  return `Column ${attention.cell.column}, row ${attention.cell.row} · ${plantLabel} — ${reasons}`;
}

// Collapsed by default: with a large garden this list can run to dozens of
// lines (one per flagged cell) and dominate the page above everything else.
// The header's own critical/stressed counts stay visible either way, so the
// "never more than a glance away" promise from this file's header comment
// still holds without the full per-cell list needing to stay expanded.
export function NeedsAttentionBanner({
  beds,
  plants,
  onSelectCell,
  onRefresh,
  onOpenIrrigationSettings,
  bare = false,
}: NeedsAttentionBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [remedyTarget, setRemedyTarget] = useState<RemedyDialogTarget | null>(null);
  const rows = beds
    .map((bed) => ({ bed, stats: summarizeBed(bed) }))
    .filter(({ stats }) => stats.attentionCells.length > 0);

  if (rows.length === 0) {
    return null;
  }

  const totalCells = rows.reduce(
    (sum, { stats }) => sum + stats.attentionCells.length,
    0,
  );
  const criticalCells = rows.reduce(
    (sum, { stats }) =>
      sum +
      stats.attentionCells.filter((attention) =>
        attention.reasons.includes("critical"),
      ).length,
    0,
  );
  const countSummary =
    criticalCells > 0
      ? `${totalCells} cell${totalCells === 1 ? "" : "s"} (${criticalCells} critical)`
      : `${totalCells} cell${totalCells === 1 ? "" : "s"}`;
  const ChevronIcon = expanded ? ChevronUp : ChevronDown;

  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper
      aria-label="Needs attention"
      className={
        bare
          ? "flex flex-col gap-2"
          : "flex flex-col gap-2 rounded-xl border p-3 sm:p-4"
      }
      style={
        bare
          ? undefined
          : {
              borderColor: "var(--color-danger-text)",
              background: "var(--color-warning-bg)",
            }
      }
    >
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls="needs-attention-list"
        className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} flex items-center justify-between gap-2 rounded text-sm font-semibold`}
        style={{ color: "var(--color-warning-text)" }}
      >
        <span className="flex items-center gap-2">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
          Needs attention — {countSummary}
        </span>
        <ChevronIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
      </button>
      {expanded && (
        <div id="needs-attention-list" className="flex flex-col gap-3">
          {rows.map(({ bed, stats }) => (
            <div key={bed.id} className="flex flex-col gap-2">
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--color-warning-text)" }}
              >
                {bed.name}
              </p>
              {groupAttentionCells(stats.attentionCells).map((group) => (
                <div key={group.key} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-warning-text)" }}>
                      {group.label} ({group.cells.length})
                    </p>
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        background: group.actionable ? "var(--color-accent-strong)" : "var(--color-surface-raised)",
                        color: group.actionable ? "white" : "var(--color-text-muted)",
                      }}
                    >
                      {group.actionable ? "fixable now" : "no in-app fix"}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {group.cells.map((attention) => (
                      <li key={`${attention.cell.column}:${attention.cell.row}`} className="flex items-center gap-2">
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
                        {attention.dominantStressDial && (
                          <button
                            type="button"
                            onClick={() =>
                              setRemedyTarget({
                                bedId: bed.id,
                                bedName: bed.name,
                                column: attention.cell.column,
                                row: attention.cell.row,
                                dial: attention.dominantStressDial as string,
                                hasActiveInfection: attention.hasActiveInfection,
                              })
                            }
                            aria-label={`View fix for column ${attention.cell.column}, row ${attention.cell.row}`}
                            className={`${FOCUS_RING} inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium`}
                            style={{ borderColor: "var(--color-warning-text)", color: "var(--color-warning-text)" }}
                          >
                            <Wrench aria-hidden="true" className="h-3 w-3" />
                            View fix
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {remedyTarget && (
        <RemedyDialog
          target={remedyTarget}
          onClose={() => setRemedyTarget(null)}
          onApplied={onRefresh}
          onOpenIrrigationSettings={onOpenIrrigationSettings}
        />
      )}
    </Wrapper>
  );
}
