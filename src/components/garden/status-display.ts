import type { SnapshotCell } from "./types";

// Shared between the per-cell grid (GardenGrid) and the aggregate summary
// (GardenSummary) so status colors/words can't drift between the two views
// of the same data.
// REMOVED shares EMPTY's swatch: both are "nothing currently planted here"
// to the eye. REMOVED is still a distinct CellStatus (see
// planting-lifecycle.ts) because its removal is a recorded, dated journal
// event rather than a silent reset — that history just isn't shown as a
// permanent visual difference in the grid, since it behaves identically to
// EMPTY for every interaction (see grid-cell-service.ts's
// EMPTY-or-REMOVED checks).
export const STATUS_STYLES: Record<SnapshotCell["status"], string> = {
  EMPTY: "bg-[var(--status-empty-bg)] border-[var(--status-empty-border)]",
  PLANTED: "bg-[var(--status-planted-bg)] border-[var(--status-planted-border)]",
  GERMINATED: "bg-[var(--status-germinated-bg)] border-[var(--status-germinated-border)]",
  GROWING: "bg-[var(--status-growing-bg)] border-[var(--status-growing-border)]",
  HARVESTED: "bg-[var(--status-harvested-bg)] border-[var(--status-harvested-border)]",
  REMOVED: "bg-[var(--status-empty-bg)] border-[var(--status-empty-border)]",
};

export const STATUS_WORD: Record<SnapshotCell["status"], string> = {
  EMPTY: "Empty",
  PLANTED: "Planted",
  GERMINATED: "Germinated",
  GROWING: "Growing",
  HARVESTED: "Harvested",
  REMOVED: "Removed",
};

// EMPTY and REMOVED excluded — both render with the same swatch (see
// STATUS_STYLES) and have nothing distinct to explain in the per-cell grid
// legend. GardenSummary (which counts both) uses STATUS_WORD directly
// rather than this list.
export const LEGEND_STATUSES: SnapshotCell["status"][] = ["PLANTED", "GERMINATED", "GROWING", "HARVESTED"];

// Shared between CellPicker (a single planting's live readout) and
// ConditionsPanel (a what-if projection's before/after) so the growth
// engine's PhenologyStage values are always worded the same way.
export const PHENOLOGY_LABEL: Record<string, string> = {
  GERMINATING: "Germinating",
  VEGETATIVE: "Vegetative growth",
  FLOWERING: "Flowering",
  FRUITING: "Fruiting",
  MATURE: "Mature",
  SENESCENT: "Dying back",
  DEAD: "Dead",
};
