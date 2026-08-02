import { CircleCheck, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { SnapshotCell } from "./types";

// Shared, lucide-free display data for the growth engine's stress/health
// state (src/domain/growth/stress-service.ts) — same convention as
// status-display.ts: one source of labels/colors consumed by GardenGrid,
// CellPicker, GardenSummary, and (via hex, since three.js can't parse CSS
// custom properties) Plant.tsx in the 3D viewer, so wording and color can't
// drift between them.

export type GrowthView = NonNullable<SnapshotCell["plantings"][number]["growth"]>;

// stress-service.ts's 9 dial keys (architecture doc §8's 8 dials, plus
// SPEC-GROWTH-003's pestDisease addition), worded for a gardener rather
// than a simulation engineer. Previously duplicated inline in CellPicker.tsx
// with `pestDisease` missing entirely — dominantStressDial could resolve to
// "pestDisease" and silently render no label at all. Fixed here.
export const STRESS_DIAL_LABEL: Record<string, string> = {
  heat: "heat stress",
  cold: "cold stress",
  drought: "drought stress",
  overwater: "overwatered",
  shade: "not enough light",
  nutrient: "nutrient-limited",
  transplantShock: "transplant shock",
  wind: "wind lodging risk",
  pestDisease: "pest & disease pressure",
};

// Regression guard for the label map above — every key stress-service.ts's
// StressDials interface declares must resolve to a real label, so a future
// 10th dial fails loudly (a test asserts this list against the map) instead
// of silently rendering nothing the way pestDisease did.
export const STRESS_DIAL_KEYS = [
  "heat",
  "cold",
  "drought",
  "overwater",
  "shade",
  "nutrient",
  "transplantShock",
  "wind",
  "pestDisease",
] as const;

// Hex per dial for the 3D viewer's base-ring color (Plant.tsx) — three.js's
// Color can't parse oklch()/CSS-custom-property strings, the same reason
// GardenScene3D.tsx's STATUS_TINT is hand-picked hex rather than resolved
// from status-display.ts's CSS tokens at runtime.
export const STRESS_DIAL_HEX: Record<string, string> = {
  heat: "#c9502f",
  cold: "#4f7fbf",
  drought: "#c98a3f",
  overwater: "#3f7fae",
  shade: "#6b6b8f",
  nutrient: "#a6a13f",
  transplantShock: "#8f6b4f",
  wind: "#5f9e8f",
  pestDisease: "#8f3f6b",
};

export type HealthBand = "healthy" | "watch" | "stressed" | "critical";

export const HEALTH_BAND_ORDER: HealthBand[] = ["healthy", "watch", "stressed", "critical"];

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  watch: "Watch",
  stressed: "Stressed",
  critical: "Critical",
};

// CSS custom properties defined in globals.css (light+dark variants) — a
// traffic-light escalation deliberately independent of status-display.ts's
// STATUS_STYLES hues, since a health dot and a cell's status fill are two
// simultaneous signals, not alternatives.
export const HEALTH_BAND_CSS: Record<HealthBand, string> = {
  healthy: "bg-[var(--color-accent-strong)]",
  watch: "bg-[var(--health-watch)]",
  stressed: "bg-[var(--health-stressed)]",
  critical: "bg-[var(--health-critical)]",
};

// Hex counterparts for the 3D viewer (same rationale as STRESS_DIAL_HEX).
export const HEALTH_BAND_HEX: Record<HealthBand, string> = {
  healthy: "#3f7d4f",
  watch: "#c9a23f",
  stressed: "#c9702f",
  critical: "#a3352a",
};

// A non-color channel for the watch->stressed->critical escalation
// (colorblind-safety fix, not a repaint — the underlying hex/CSS values
// above are unchanged, since DISEASE_SEVERITY_CSS in pest-display.ts reuses
// the same ramp and a hue shift here would ripple into that signal too).
// The dot stays the quick-glance color cue; this icon is the redundant
// signal WCAG 1.4.1 asks for beyond the (already-present) text label.
export const HEALTH_BAND_ICON: Record<HealthBand, LucideIcon> = {
  healthy: CircleCheck,
  watch: TriangleAlert,
  stressed: TriangleAlert,
  critical: OctagonAlert,
};

// Thresholds chosen to match the sentences this replaces (CellPicker
// previously hardcoded ">0.6 = under sustained stress" and
// "<0.5 = wilting from drought" inline) rather than inventing new cutoffs,
// plus a "watch" tier for when a single dial crossed stress-service.ts's own
// 0.4 dominant-dial display threshold but hasn't yet become sustained.
const CRITICAL_CUMULATIVE_STRESS = 0.75;
const STRESSED_CUMULATIVE_STRESS = 0.6;
const WATCH_CUMULATIVE_STRESS = 0.3;
const WILTING_WATER_CONTENT_INDEX = 0.5;

// Only the 4 fields healthBand()/cellHealthPhrase() actually read — a
// narrower interface than GrowthView (which is the full PlantingGrowthView
// shape) so callers with a smaller local growth-prop type (Plant.tsx's own
// PlantGrowthProps, which doesn't carry matureHeightCm) can call these
// directly without carrying fields they never asked for. Every GrowthView
// already structurally satisfies this.
export interface HealthBandInput {
  phenologyStage: string;
  cumulativeStress: number;
  waterContentIndex: number;
  dominantStressDial: string | null;
}

export function healthBand(growth: HealthBandInput): HealthBand {
  if (growth.phenologyStage === "DEAD" || growth.cumulativeStress >= CRITICAL_CUMULATIVE_STRESS) {
    return "critical";
  }
  if (growth.cumulativeStress >= STRESSED_CUMULATIVE_STRESS || growth.waterContentIndex < WILTING_WATER_CONTENT_INDEX) {
    return "stressed";
  }
  if (growth.cumulativeStress >= WATCH_CUMULATIVE_STRESS || growth.dominantStressDial !== null) {
    return "watch";
  }
  return "healthy";
}

// Text carrier for the health-band dot's aria-label (WCAG 1.4.1: color must
// never be the only signal) — folded into GardenGrid's per-cell aria-label
// rather than shown as separate visible text, since the dot itself is
// aria-hidden.
export function cellHealthPhrase(growth: HealthBandInput | null): string | null {
  if (!growth) {
    return null;
  }
  const band = healthBand(growth);
  if (band === "healthy") {
    return null;
  }
  const dialLabel = growth.dominantStressDial
    ? (STRESS_DIAL_LABEL[growth.dominantStressDial] ?? growth.dominantStressDial)
    : null;
  const bandPhrase = HEALTH_BAND_LABEL[band].toLowerCase();
  return dialLabel ? `${bandPhrase}: ${dialLabel}` : bandPhrase;
}
