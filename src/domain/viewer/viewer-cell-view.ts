// The per-cell shape the 3D viewer renders. Intentionally narrower than the
// underlying domain data: the viewer is a low-fidelity preview, so continuous
// light exposure collapses to the two BaselineLight buckets and water state
// to a boolean. cellId/wet/lightLevel are the whole contract a SIMULATION
// overlay has to be able to restate; everything else is optional enrichment
// used only for placement and labelling.

import type { CellStatus } from "../grid/planting-lifecycle";

export type ViewerLightLevel = "PARTIAL_SHADE" | "FULL_SUN";

export interface ViewerCellView {
  cellId: string;
  wet: boolean;
  lightLevel: ViewerLightLevel;
  // The cell's structural (time-independent) light baseline, carried
  // alongside the time-derived lightLevel so a SIMULATION-mode time-of-day
  // scrub can recompute exposure client-side, live, with no server round
  // trip — and with no chance of writing anything while doing it.
  baselineLight?: ViewerLightLevel;
  bedIndex?: number;
  bedName?: string;
  column?: number;
  row?: number;
  status?: CellStatus;
  plantCount?: number;
}

// Above this share of peak exposure a cell reads as being in full sun for the
// viewer's two-level display. Sits above the PARTIAL_SHADE curve's own peak
// (0.55 in cell-light-exposure.ts) on purpose: a structurally shaded cell
// must never render as FULL_SUN, no matter the hour.
export const FULL_SUN_EXPOSURE_THRESHOLD = 0.6;

export function bucketLightLevel(exposure: number): ViewerLightLevel {
  return exposure >= FULL_SUN_EXPOSURE_THRESHOLD ? "FULL_SUN" : "PARTIAL_SHADE";
}
