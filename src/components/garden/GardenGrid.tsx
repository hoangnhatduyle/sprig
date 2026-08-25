"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import Image from "next/image";
import { EQUIPMENT_KIND_ICON, EQUIPMENT_KIND_LABEL } from "./equipment-display";
import { plantName } from "./plant-lookup";
import { STATUS_STYLES } from "./status-display";
import { HEALTH_BAND_CSS, cellHealthPhrase, healthBand } from "./stress-display";
import {
  DISEASE_SEVERITY_CSS,
  MIN_DISPLAY_POPULATION,
  MIN_DISPLAY_SEVERITY,
  PEST_ICON,
  PEST_LABEL,
  PREDATOR_ICON,
  PREDATOR_LABEL,
  cellInfectionPhrase,
  diseaseSeverityBand,
} from "./pest-display";
import { COMPANION_EFFECT_ICON, cellCompanionEffectPhrase } from "./companion-effect-display";
import { moistureHeatmapColor } from "./soil-display";
import { LEGEND_SECTIONS } from "./legend-sections";
import { LegendPanel } from "./LegendPanel";
import type { PlantOption, SelectedCell, SnapshotBed, SnapshotCell } from "./types";

type GardenGridProps = {
  beds: SnapshotBed[];
  plants: PlantOption[];
  selectedCell: SelectedCell | null;
  disabled?: boolean;
  onCellClick: (bed: SnapshotBed, cell: SnapshotCell, event: React.MouseEvent<HTMLButtonElement>) => void;
  // Multi-select overlay (BulkActionBar.tsx): when selectMode is true, a
  // click still routes through onCellClick — GardenView.tsx branches there
  // on whether select mode is active — this component only needs to know
  // which cells are currently in the set to render the checkbox highlight
  // instead of the single-select ring below.
  selectMode?: boolean;
  selectedCellKeys?: ReadonlySet<string>;
  // Paired with the soil-moisture-heatmap toggle below the grid (both are
  // grid-display-mode switches, not bed content) rather than living in its
  // own row above the beds — selectMode/selectedCellKeys stay owned by
  // GardenView.tsx (they drive handleCellClick and BulkActionBar there);
  // this is only the toggle affordance.
  onToggleSelectMode?: () => void;
};

function bedLabel(name: string): string {
  return /\bbed\b/i.test(name) ? name : `Bed ${name}`;
}

// The cell's own primary display text: the plant's common name where one
// exists, blank otherwise. REMOVED cells render blank like EMPTY ones — no
// active planting left to name, and the removal is still findable via the
// status word in aria-label plus the bed's removed-count in GardenSummary,
// not a permanent glyph in the grid.
function cellPrimaryLabel(cell: SnapshotCell, plants: PlantOption[]): string {
  if (cell.plantIds.length === 0) {
    return "";
  }
  return plantName(plants, cell.plantIds[0]);
}

function plantNamesSuffix(cell: SnapshotCell, plants: PlantOption[]): string {
  return cell.plantIds.length > 0 ? `, ${cell.plantIds.map((id) => plantName(plants, id)).join(", ")}` : "";
}


function DroppableCell({
  bed,
  cell,
  plants,
  selectedCell,
  disabled,
  onCellClick,
  showMoistureHeatmap,
  selectMode,
  isMultiSelected,
}: {
  bed: SnapshotBed;
  cell: SnapshotCell;
  plants: PlantOption[];
  selectedCell: SelectedCell | null;
  disabled: boolean;
  onCellClick: GardenGridProps["onCellClick"];
  showMoistureHeatmap: boolean;
  selectMode: boolean;
  isMultiSelected: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${bed.id}:${cell.column}:${cell.row}`,
    data: { bed, cell },
    disabled: disabled || selectMode,
  });
  const isSelected =
    !selectMode &&
    selectedCell?.bedId === bed.id &&
    selectedCell.column === cell.column &&
    selectedCell.row === cell.row;
  const companionCount = cell.plantIds.length > 1 ? cell.plantIds.length - 1 : 0;
  const primary = plants.find((plant) => plant.id === cell.plantIds[0]);
  // Health-at-a-glance (SPEC-SURFACE-001): previously stress/wilting state
  // only reached CellPicker's text readout after clicking a cell — the dot
  // below is the fix, visible across the whole grid without a click.
  const primaryGrowth = cell.plantings[0]?.growth ?? null;
  const band = primaryGrowth ? healthBand(primaryGrowth) : null;
  const healthPhrase = cellHealthPhrase(primaryGrowth);
  // Disease is per-planting, not per-cell — check every planting, not just
  // the primary one, since a companion-planted cell can carry two
  // independent infections.
  const activeInfections = cell.plantings.flatMap((planting) =>
    planting.infections.filter((infection) => infection.severity >= MIN_DISPLAY_SEVERITY),
  );
  const dominantInfectionBand =
    activeInfections.length > 0
      ? diseaseSeverityBand(Math.max(...activeInfections.map((infection) => infection.severity)))
      : null;
  const infectionPhrase = cellInfectionPhrase(activeInfections);
  // Same-cell companion effects the primary planting is receiving — see
  // grid-cell-service.ts's companionEffectsForCell. Icon-only in-cell (no
  // room for text at this size), with cellCompanionEffectPhrase supplying
  // the accessible name via aria-label, same WCAG 1.4.1 pattern the health
  // dot and infection dot already use.
  const companionEffects = cell.plantings[0]?.companionEffects ?? [];
  const companionPhrase = cellCompanionEffectPhrase(companionEffects);
  const heatmapColor =
    showMoistureHeatmap && cell.environment ? moistureHeatmapColor(cell.environment.soilMoistureFraction) : null;

  return (
    <button
      ref={setNodeRef}
      type="button"
      disabled={disabled}
      onClick={(event) => onCellClick(bed, cell, event)}
      aria-current={isSelected ? "true" : undefined}
      aria-pressed={selectMode ? isMultiSelected : undefined}
      aria-label={`${bedLabel(bed.name)}, column ${cell.column}, row ${cell.row}, ${cell.status.toLowerCase()}${plantNamesSuffix(cell, plants)}${healthPhrase ? `, ${healthPhrase}` : ""}${infectionPhrase ? `, ${infectionPhrase}` : ""}${companionPhrase ? `, ${companionPhrase}` : ""}${selectMode ? `, ${isMultiSelected ? "selected" : "not selected"}` : ""}`}
      className={`relative flex aspect-square min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border-2 p-1 text-center text-[10px] font-medium leading-tight shadow-sm outline-none transition-[transform,box-shadow,background-color] duration-150 @min-[42rem]:text-xs xl:min-h-0 hover:z-10 hover:-translate-y-0.5 hover:shadow-md focus-visible:z-20 focus-visible:-translate-y-0.5 focus-visible:shadow-md focus-visible:ring-2 focus-visible:ring-[var(--color-clay)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-ring-offset)] disabled:cursor-not-allowed disabled:opacity-60 ${showMoistureHeatmap ? "" : STATUS_STYLES[cell.status]} ${
        isSelected ? "z-10 -translate-y-0.5 shadow-md ring-2 ring-[var(--color-clay)] ring-offset-1" : ""
      } ${isMultiSelected ? "z-10 -translate-y-0.5 shadow-md ring-2 ring-[var(--color-accent)] ring-offset-1" : ""} ${isOver ? "z-20 scale-105 ring-4 ring-[var(--color-accent)]" : ""}`}
      style={{
        color: "var(--status-cell-text)",
        gridColumn: cell.column,
        gridRow: cell.row,
        ...(heatmapColor ? { background: heatmapColor, borderColor: heatmapColor } : {}),
      }}
    >
      {primary?.imageUrl && (
        <Image src={primary.imageUrl} alt="" fill unoptimized className="object-cover opacity-35" />
      )}
      {selectMode && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 right-1 z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 bg-[var(--color-surface-raised)]"
          style={{
            borderColor: isMultiSelected ? "var(--color-accent)" : "var(--color-border)",
            background: isMultiSelected ? "var(--color-accent)" : "var(--color-surface-raised)",
          }}
        >
          {isMultiSelected && (
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8.5 6.5 12 13 4.5" />
            </svg>
          )}
        </span>
      )}
      {band && band !== "healthy" && (
        <span
          aria-hidden="true"
          className={`absolute left-1 top-1 z-10 h-2 w-2 shrink-0 rounded-full ring-1 ring-[var(--color-surface-raised)] ${HEALTH_BAND_CSS[band]}`}
        />
      )}
      {dominantInfectionBand && (
        <span
          aria-hidden="true"
          className={`absolute right-1 top-1 z-10 h-2 w-2 shrink-0 rounded-full ring-1 ring-[var(--color-surface-raised)] ${DISEASE_SEVERITY_CSS[dominantInfectionBand]}`}
        />
      )}
      <span aria-hidden="true" className="relative z-10 line-clamp-2 w-full break-words [overflow-wrap:anywhere]">
        {cellPrimaryLabel(cell, plants)}
      </span>
      {companionEffects.length > 0 && (
        <span aria-hidden="true" className="relative z-10 flex items-center gap-0.5">
          {companionEffects.slice(0, 2).map((effect) => {
            const Icon = COMPANION_EFFECT_ICON[effect.kind];
            return <Icon key={effect.kind} className="h-2.5 w-2.5 opacity-80" />;
          })}
        </span>
      )}
      {companionCount > 0 && (
        <span aria-hidden="true" className="relative z-10 text-[10px] opacity-80">+{companionCount}</span>
      )}
    </button>
  );
}

export function GardenGrid({
  beds,
  plants,
  selectedCell,
  disabled = false,
  onCellClick,
  selectMode = false,
  selectedCellKeys,
  onToggleSelectMode,
}: GardenGridProps) {
  const showEquipmentLegend = beds.some((bed) => bed.equipment.length > 0);
  const showInfectionLegend = beds.some((bed) =>
    bed.cells.some((cell) =>
      cell.plantings.some((planting) => planting.infections.some((infection) => infection.severity >= MIN_DISPLAY_SEVERITY)),
    ),
  );
  const showPestsLegend = beds.some((bed) => bed.pests.some((pest) => pest.population >= MIN_DISPLAY_POPULATION));
  const showPredatorsLegend = beds.some((bed) =>
    bed.predators.some((predator) => predator.population >= MIN_DISPLAY_POPULATION),
  );
  // Local-only UI state (not persisted) — a grid-wide overlay toggle, the
  // one continuous (not discrete-band) legend row, kept out of
  // LEGEND_SECTIONS/LegendPanel's discrete-band data model for that reason.
  const [showMoistureHeatmap, setShowMoistureHeatmap] = useState(false);
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div
        data-testid="garden-beds"
        className="grid grid-cols-1 justify-items-center gap-5 @min-[23rem]:grid-cols-2 @min-[23rem]:items-stretch"
      >
        {beds.map((bed) => {
          const plantedCells = bed.cells.filter((cell) => cell.plantIds.length > 0).length;

          return (
            <section
              key={bed.id}
              data-bed-card
              aria-labelledby={`bed-${bed.id}-heading`}
              className="w-full max-w-96 rounded-xl border bg-[var(--color-surface-raised)] p-3 sm:p-4"
              style={{ borderColor: "var(--color-border)", boxShadow: "var(--shadow-card)" }}
            >
              <header className="mb-3 flex flex-col gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
                    Garden bed
                  </p>
                  <h2
                    id={`bed-${bed.id}-heading`}
                    className="text-xl sm:text-2xl"
                    style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
                  >
                    {bed.name}
                  </h2>
                  {bed.equipment.length > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-1.5">
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
                  {bed.pests.some((pest) => pest.population >= MIN_DISPLAY_POPULATION) && (
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {bed.pests
                        .filter((pest) => pest.population >= MIN_DISPLAY_POPULATION)
                        .map((pest) => {
                          const Icon = PEST_ICON[pest.pestKey];
                          return (
                            <li
                              key={pest.pestKey}
                              className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
                            >
                              {Icon && <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />}
                              {PEST_LABEL[pest.pestKey] ?? pest.pestKey}
                            </li>
                          );
                        })}
                    </ul>
                  )}
                  {bed.predators.some((predator) => predator.population >= MIN_DISPLAY_POPULATION) && (
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {bed.predators
                        .filter((predator) => predator.population >= MIN_DISPLAY_POPULATION)
                        .map((predator) => {
                          const Icon = PREDATOR_ICON[predator.predatorKey];
                          return (
                            <li
                              key={predator.predatorKey}
                              className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
                            >
                              {Icon && <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />}
                              {PREDATOR_LABEL[predator.predatorKey] ?? predator.predatorKey}
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </div>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  <span className="font-semibold" style={{ color: "var(--color-text)" }}>{plantedCells}</span>
                  {" / "}
                  {bed.cells.length} planted
                </p>
              </header>
              <div className="-m-1 p-1">
                <div
                  className="grid w-full gap-1.5 sm:gap-2"
                  style={{
                    gridTemplateColumns: `repeat(${bed.gridCols}, minmax(0, 1fr))`,
                  }}
                >
                  {bed.cells.map((cell) => {
                    return (
                  <DroppableCell
                    key={`${cell.column}-${cell.row}`}
                    bed={bed}
                    cell={cell}
                    plants={plants}
                    selectedCell={selectedCell}
                    disabled={disabled}
                    onCellClick={onCellClick}
                    showMoistureHeatmap={showMoistureHeatmap}
                    selectMode={selectMode}
                    isMultiSelected={selectedCellKeys?.has(`${bed.id}:${cell.column}:${cell.row}`) ?? false}
                  />
                );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-pressed={showMoistureHeatmap}
          onClick={() => setShowMoistureHeatmap((value) => !value)}
          className="rounded-md border px-2.5 py-1 text-xs font-medium"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          {showMoistureHeatmap ? "Hide" : "Show"} soil moisture heatmap
        </button>
        {showMoistureHeatmap && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
            <span>Dry</span>
            <span
              aria-hidden="true"
              className="h-2.5 w-16 rounded-full"
              style={{ background: `linear-gradient(to right, ${moistureHeatmapColor(0)}, ${moistureHeatmapColor(1)})` }}
            />
            <span>Saturated</span>
          </div>
        )}
        {onToggleSelectMode && (
          <button
            type="button"
            aria-pressed={selectMode}
            onClick={onToggleSelectMode}
            className="rounded-md border px-2.5 py-1 text-xs font-medium"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
              background: selectMode ? "var(--color-surface-raised)" : "transparent",
            }}
          >
            {selectMode ? "Exit select mode" : "Select cells"}
          </button>
        )}
        {selectMode && (
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Click cells above to select them, then choose an action below.
          </p>
        )}
      </div>
      <LegendPanel
        sections={LEGEND_SECTIONS}
        ctx={{
          showEquipment: showEquipmentLegend,
          showInfection: showInfectionLegend,
          showPests: showPestsLegend,
          showPredators: showPredatorsLegend,
        }}
      />
    </div>
  );
}
