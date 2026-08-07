"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { summarizeBed } from "./bed-summary";
import { EQUIPMENT_KIND_ICON, EQUIPMENT_KIND_LABEL } from "./equipment-display";
import { plantName } from "./plant-lookup";
import { STATUS_STYLES, STATUS_WORD } from "./status-display";
import {
  PEST_LABEL,
  PREDATOR_ICON,
  PREDATOR_LABEL,
  pestPressureBand,
} from "./pest-display";
import { FOCUS_RING } from "./ui-constants";
import type { PlantOption, SnapshotBed, SnapshotCell } from "./types";

type GardenSummaryProps = {
  beds: SnapshotBed[];
  plants: PlantOption[];
};

// Beyond this many varieties, the tag list wraps into unreadable clutter —
// collapse the tail behind a "+N more" toggle instead of dumping all of it
// inline (a 28-variety bed was the reported case).
const COLLAPSED_PLANT_COUNT = 4;

function PlantVarietyList({ plantCounts, plants }: { plantCounts: { plantId: string; count: number }[]; plants: PlantOption[] }) {
  const [expanded, setExpanded] = useState(false);
  if (plantCounts.length === 0) {
    return null;
  }
  const hiddenCount = plantCounts.length - COLLAPSED_PLANT_COUNT;
  const visible = expanded || hiddenCount <= 0 ? plantCounts : plantCounts.slice(0, COLLAPSED_PLANT_COUNT);
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-wrap gap-1.5">
        {visible.map(({ plantId, count }) => (
          <li
            key={plantId}
            className="rounded-full border px-2 py-0.5 text-xs"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
          >
            {plantName(plants, plantId)} × {count}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className={`inline-flex w-fit items-center gap-1 rounded text-xs font-medium underline decoration-dotted underline-offset-2 ${FOCUS_RING}`}
          style={{ color: "var(--color-text-muted)" }}
        >
          {expanded ? "Show fewer" : `+${hiddenCount} more`}
          <ChevronDown
            aria-hidden="true"
            className="h-3 w-3 shrink-0 transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : undefined }}
          />
        </button>
      )}
    </div>
  );
}

function BedSummaryCard({ bed, plants }: { bed: SnapshotBed; plants: PlantOption[] }) {
  const {
    filledCells,
    statusCounts,
    plantCounts,
    stressedCells,
    criticalCells,
    infectedCells,
    dominantPestKey,
    dominantPredatorKey,
  } = summarizeBed(bed);
  const totalCells = bed.cells.length;
  const needsAttention = stressedCells + criticalCells;
  const statusEntries = (Object.keys(statusCounts) as SnapshotCell["status"][])
    .filter((status) => status !== "EMPTY")
    .sort((a, b) => (statusCounts[b] ?? 0) - (statusCounts[a] ?? 0));

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border p-3.5" style={{ borderColor: "var(--color-border)" }}>
      <div className="flex items-end justify-between gap-3">
        <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>
          {bed.name}
        </p>
        <p className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
          {filledCells}
        </p>
        </div>
        <p className="pb-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>of {totalCells} cells planted</p>
      </div>

      {(needsAttention > 0 || infectedCells > 0 || dominantPestKey) && (
        <p
          className="rounded-md px-2 py-1 text-xs font-semibold"
          style={{ background: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}
        >
          {needsAttention > 0 && (
            <>
              Needs attention: {needsAttention} cell{needsAttention === 1 ? "" : "s"}
              {criticalCells > 0 && ` (${criticalCells} critical)`}
            </>
          )}
          {infectedCells > 0 && (
            <>
              {needsAttention > 0 && " · "}
              {infectedCells} infected cell{infectedCells === 1 ? "" : "s"}
            </>
          )}
          {dominantPestKey && (
            <>
              {(needsAttention > 0 || infectedCells > 0) && " · "}
              {PEST_LABEL[dominantPestKey] ?? dominantPestKey} pressure (
              {pestPressureBand(bed.pests.find((pest) => pest.pestKey === dominantPestKey)?.population ?? 0)})
            </>
          )}
        </p>
      )}

      {bed.equipment.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {bed.equipment.map((override) => {
            const Icon = EQUIPMENT_KIND_ICON[override.kind];
            return (
              <li
                key={override.id}
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
              >
                <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
                {EQUIPMENT_KIND_LABEL[override.kind]}
              </li>
            );
          })}
        </ul>
      )}

      {dominantPredatorKey && (
        // Predator presence is good news, not a pressure to escalate (see
        // pest-display.ts's bedPredatorPhrase comment) — deliberately kept
        // out of the warning-styled "Needs attention" block above and given
        // the app's positive-signal accent tokens instead.
        <p
          className="inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
          style={{ borderColor: "var(--color-accent)", color: "var(--color-accent-strong)" }}
        >
          {(() => {
            const Icon = PREDATOR_ICON[dominantPredatorKey];
            return Icon && <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />;
          })()}
          {PREDATOR_LABEL[dominantPredatorKey] ?? dominantPredatorKey} active
        </p>
      )}

      {statusEntries.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {statusEntries.map((status) => (
            <li key={status} className="flex items-center gap-1.5 text-sm" style={{ color: "var(--color-text)" }}>
              <span aria-hidden="true" className={`inline-block h-3 w-3 shrink-0 rounded-sm border-2 ${STATUS_STYLES[status]}`} />
              {STATUS_WORD[status]}
              <span style={{ color: "var(--color-text-muted)" }}>({statusCounts[status]})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Nothing planted yet.
        </p>
      )}

      <PlantVarietyList plantCounts={plantCounts} plants={plants} />
    </div>
  );
}

// Fills the CellPicker's slot when nothing is selected, rather than leaving
// that space blank — an at-a-glance answer to "what's planted where" across
// both beds.
export function GardenSummary({ beds, plants }: GardenSummaryProps) {
  const bedStats = beds.map((bed) => summarizeBed(bed));
  const totalCells = beds.reduce((sum, bed) => sum + bed.cells.length, 0);
  const totalFilled = bedStats.reduce((sum, stats) => sum + stats.filledCells, 0);
  const percentPlanted = totalCells > 0 ? Math.round((totalFilled / totalCells) * 100) : 0;
  const totalPlantVarieties = new Set(bedStats.flatMap((stats) => stats.plantCounts.map((entry) => entry.plantId))).size;

  return (
    <aside
      className="flex w-full flex-col gap-4 rounded-xl border p-4 sm:p-5"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface-raised)",
        boxShadow: "var(--shadow-card)",
      }}
      aria-label="Garden summary"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
          Garden overview
        </p>
        {/* Whole-garden totals, ahead of the per-bed breakdown below: the
            report's headline numbers, not just a repeat of the two bed
            cards' own counts added together in the reader's head. */}
        <dl className="mt-2 grid grid-cols-3 divide-x" style={{ borderColor: "var(--color-border)" }}>
          <div className="pr-3">
            <dt className="mb-1 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>
              Planted
            </dt>
            <dd className="text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
              {percentPlanted}%
            </dd>
            <dd className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {totalFilled} of {totalCells} cells
            </dd>
          </div>
          <div className="px-3">
            <dt className="mb-1 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>
              Beds
            </dt>
            <dd className="text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
              {beds.length}
            </dd>
          </div>
          <div className="pl-3">
            <dt className="mb-1 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>
              Plant varieties
            </dt>
            <dd className="text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
              {totalPlantVarieties}
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-3 border-t pt-4 sm:grid-cols-2" style={{ borderColor: "var(--color-border)" }}>
        {beds.map((bed) => (
          <BedSummaryCard key={bed.id} bed={bed} plants={plants} />
        ))}
      </div>
    </aside>
  );
}
