// Shared display data for per-cell soil state (CellEnvironmentView) and
// per-bed soil texture (SnapshotSoilProfile) — same convention as
// stress-display.ts: hand-written maps (soil fields aren't a keyed catalog
// the way disease/pest/predator entries are), banding functions, and WCAG
// 1.4.1 text-carrier phrases, consumed by CellPicker and GardenGrid.

import type { CellEnvironmentView, SnapshotSoilProfile } from "@/domain/grid/grid-cell-service";

// The corrected 4-field list — CellPicker.tsx previously hard-coded a
// 3-entry tuple for its "low on n/p/k" check that omitted
// calciumPoolFraction even though the field was already on the environment
// prop, silently leaving calcium deficiency unflagged. This is the fixed,
// single source of truth every "low nutrient" consumer should read from.
export const NUTRIENT_FIELDS = [
  "nitrogenPoolFraction",
  "phosphorusPoolFraction",
  "potassiumPoolFraction",
  "calciumPoolFraction",
] as const;

export type NutrientField = (typeof NUTRIENT_FIELDS)[number];

export const NUTRIENT_LABEL: Record<NutrientField, string> = {
  nitrogenPoolFraction: "Nitrogen (N)",
  phosphorusPoolFraction: "Phosphorus (P)",
  potassiumPoolFraction: "Potassium (K)",
  calciumPoolFraction: "Calcium (Ca)",
};

// Same cutoff CellPicker.tsx's original inline check used — preserved
// behavior, only the omission is fixed.
export const LOW_NUTRIENT_THRESHOLD = 0.3;

export function lowNutrients(environment: Pick<CellEnvironmentView, NutrientField>): NutrientField[] {
  return NUTRIENT_FIELDS.filter((field) => environment[field] < LOW_NUTRIENT_THRESHOLD);
}

// Text carrier for the soil card / cell aria-label (WCAG 1.4.1 — mirrors
// cellHealthPhrase/cellInfectionPhrase in stress-display.ts/pest-display.ts).
export function cellSoilPhrase(environment: CellEnvironmentView | null): string | null {
  if (!environment) {
    return null;
  }
  const low = lowNutrients(environment);
  if (low.length === 0) {
    return null;
  }
  return `low on ${low.map((field) => NUTRIENT_LABEL[field]).join("/")}`;
}

// A small heuristic bucketing of sand/silt/clay into a human phrase — same
// "simplified approximation, not a real pedotransfer function" caveat
// water-bucket-service.ts's deriveSoilConstants already documents for the
// same input. Good enough to explain *why* a bed's field-capacity/
// wilting-point numbers look the way they do, not a USDA-triangle lookup.
export function textureLabel(profile: SnapshotSoilProfile): string {
  if (profile.clayPct >= 40) {
    return "clay-heavy";
  }
  if (profile.sandPct >= 60) {
    return "sandy";
  }
  if (profile.sandPct <= 25 && profile.clayPct <= 25) {
    return "silty";
  }
  if (profile.sandPct >= 40 && profile.clayPct <= 25) {
    return "sandy loam";
  }
  return "balanced loam";
}

export type WeedPressureBand = "low" | "moderate" | "high";

// Mirrors pest-display.ts's MIN_DISPLAY_POPULATION cosmetic-threshold
// convention: weedPressureFraction grows continuously from 0, so a tiny
// nonzero value isn't worth flagging as "weeds present."
export const MIN_DISPLAY_WEED_PRESSURE = 0.15;

const HIGH_WEED_PRESSURE = 0.6;
const MODERATE_WEED_PRESSURE = 0.3;

export function weedPressureBand(fraction: number): WeedPressureBand {
  if (fraction >= HIGH_WEED_PRESSURE) return "high";
  if (fraction >= MODERATE_WEED_PRESSURE) return "moderate";
  return "low";
}

export const WEED_PRESSURE_LABEL: Record<WeedPressureBand, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
};

// A sequential, colorblind-safe moisture gradient — amber (dry) to teal
// (saturated). Deliberately NOT the health-band ramp's yellow->orange->red
// escalation (stress-display.ts's HEALTH_BAND_HEX): that ramp signals
// *severity*, this one signals *magnitude*, and a user could have both a
// health dot and this heatmap visible on the same cell at once — reusing
// the same hues would make them read as the same signal.
const DRY_HUE = 55; // amber
const WET_HUE = 200; // teal-blue
const HEATMAP_CHROMA = 0.09;
const HEATMAP_LIGHTNESS = 0.78;

export function moistureHeatmapColor(fraction: number): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  const hue = DRY_HUE + (WET_HUE - DRY_HUE) * clamped;
  return `oklch(${HEATMAP_LIGHTNESS} ${HEATMAP_CHROMA} ${hue})`;
}
