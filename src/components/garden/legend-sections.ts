import type { LucideIcon } from "lucide-react";
import { LEGEND_STATUSES, STATUS_STYLES, STATUS_WORD } from "./status-display";
import { HEALTH_BAND_CSS, HEALTH_BAND_ICON, HEALTH_BAND_LABEL, HEALTH_BAND_ORDER } from "./stress-display";
import { EQUIPMENT_KIND_ICON, EQUIPMENT_KIND_LABEL } from "./equipment-display";
import { DISEASE_SEVERITY_CSS, PEST_ICON, PEST_LABEL, PREDATOR_ICON, PREDATOR_LABEL } from "./pest-display";
import { PEST_SWARM_COLOR, PREDATOR_SWARM_COLOR } from "@/domain/garden-3d/pest-swarm-3d";

// A single canonical, ordered list of legend rows — the data-only fix for
// GridLegend (GardenGrid.tsx) and Viewer3DLegend.tsx having independently
// re-implemented the same status/health/equipment/pest/predator rows with
// different color sources and inconsistent visual language. Zero new
// colors are introduced here: every value is imported from the existing
// per-domain display module, this file only re-orders/re-declares them
// into one shared source so the two legends can't structurally drift again.
//
// cssClass is a Tailwind class over a CSS custom property (theme-aware,
// light/dark) — used whenever one already exists (status, health). hex is a
// literal color string, used only for signals that never got a CSS-var
// counterpart (pest/predator swarm colors, defined directly as hex in
// pest-swarm-3d.ts for the 3D mesh and reused here for the matching legend
// dot). Never invent a NEW hex-only entry when a cssClass source exists —
// see stress-display.ts's HEALTH_BAND_HEX for why that duplication existed
// in the first place (Viewer3DLegend is plain sibling DOM, not a canvas
// element, so its swatches never actually needed hex).
export interface LegendEntry {
  key: string;
  label: string;
  cssClass?: string;
  hex?: string;
  Icon?: LucideIcon;
}

export interface LegendVisibilityContext {
  showEquipment: boolean;
  showInfection: boolean;
  showPests: boolean;
  showPredators: boolean;
}

export interface LegendSection {
  id: string;
  entries: LegendEntry[];
  show: (ctx: LegendVisibilityContext) => boolean;
}

const STATUS_SECTION: LegendSection = {
  id: "status",
  show: () => true,
  entries: LEGEND_STATUSES.map((status) => ({
    key: status,
    label: STATUS_WORD[status],
    cssClass: STATUS_STYLES[status],
  })),
};

const HEALTH_SECTION: LegendSection = {
  id: "health",
  show: () => true,
  entries: [
    ...HEALTH_BAND_ORDER.filter((band) => band !== "healthy").map((band) => ({
      key: band,
      label: `${HEALTH_BAND_LABEL[band]} plant`,
      cssClass: HEALTH_BAND_CSS[band],
      Icon: HEALTH_BAND_ICON[band],
    })),
  ],
};

const INFECTION_SECTION: LegendSection = {
  id: "infection",
  show: (ctx) => ctx.showInfection,
  entries: [{ key: "infection", label: "Active infection", cssClass: DISEASE_SEVERITY_CSS.moderate }],
};

const EQUIPMENT_SECTION: LegendSection = {
  id: "equipment",
  show: (ctx) => ctx.showEquipment,
  entries: (Object.keys(EQUIPMENT_KIND_LABEL) as Array<keyof typeof EQUIPMENT_KIND_LABEL>).map((kind) => ({
    key: kind,
    label: EQUIPMENT_KIND_LABEL[kind],
    Icon: EQUIPMENT_KIND_ICON[kind],
  })),
};

const PESTS_SECTION: LegendSection = {
  id: "pests",
  show: (ctx) => ctx.showPests,
  entries: Object.keys(PEST_LABEL).map((key) => ({
    key,
    label: `${PEST_LABEL[key]} pressure`,
    hex: PEST_SWARM_COLOR,
    Icon: PEST_ICON[key],
  })),
};

const PREDATORS_SECTION: LegendSection = {
  id: "predators",
  show: (ctx) => ctx.showPredators,
  entries: Object.keys(PREDATOR_LABEL).map((key) => ({
    key,
    label: `${PREDATOR_LABEL[key]} active`,
    hex: PREDATOR_SWARM_COLOR,
    Icon: PREDATOR_ICON[key],
  })),
};

export const LEGEND_SECTIONS: LegendSection[] = [
  STATUS_SECTION,
  HEALTH_SECTION,
  INFECTION_SECTION,
  EQUIPMENT_SECTION,
  PESTS_SECTION,
  PREDATORS_SECTION,
];
