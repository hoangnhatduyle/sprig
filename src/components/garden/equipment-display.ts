import { Blinds, Lightbulb, Umbrella, type LucideIcon } from "lucide-react";
import type { ConditionOverrideKind } from "@/domain/grid/grid-cell-service";

// Shared bed-equipment display data (SnapshotEquipment.kind, see
// grid-cell-service.ts) — same convention as status-display.ts/
// stress-display.ts: one source of labels/icons consumed by GardenGrid's
// per-bed chips, ConditionsPanel's install/active-equipment UI, and the 3D
// legend, so a shade cloth reads as the same word and icon everywhere.

export const EQUIPMENT_KIND_LABEL: Record<ConditionOverrideKind, string> = {
  SHADE_CLOTH: "Shade cloth",
  GROW_LIGHT: "Grow light",
  RAIN_COVER: "Rain cover",
};

export const EQUIPMENT_KIND_EFFECT: Record<ConditionOverrideKind, string> = {
  SHADE_CLOTH: "less light",
  GROW_LIGHT: "more light",
  RAIN_COVER: "less rain",
};

export const EQUIPMENT_KIND_ICON: Record<ConditionOverrideKind, LucideIcon> = {
  SHADE_CLOTH: Blinds,
  GROW_LIGHT: Lightbulb,
  RAIN_COVER: Umbrella,
};

// Mirrors bed-condition-override-service.ts's INTENSITY_BOUNDS — kept as a
// display/slider bound here; the server re-validates independently, so a
// stale client copy can only be overly permissive in the UI, never actually
// bypass the real limit.
export const EQUIPMENT_KIND_MAX_INTENSITY: Record<ConditionOverrideKind, number> = {
  SHADE_CLOTH: 0.8,
  GROW_LIGHT: 0.6,
  RAIN_COVER: 0.9,
};
