import { Bug, Flower2, OctagonAlert, Sprout, type LucideIcon } from "lucide-react";
import type { CompanionEffectKind } from "@/domain/ecology/companion-catalog";
import type { SnapshotCompanionEffect } from "./types";

// Shared display data for SnapshotCompanionEffect (same-cell companion
// pairings — see grid-cell-service.ts's companionEffectsForCell). Mirrors
// stress-display.ts's hand-written-literal-union convention rather than
// pest-display.ts's catalog-derived one: CompanionEffectSource
// (companion-catalog.ts) has no displayName field, since it's a source-
// species table, not a keyed catalog — CompanionEffectKind is a small,
// closed 4-value union instead.

// Hand-listed (not derived from a catalog array) since CompanionEffectKind
// is a closed union, not an iterable catalog — same regression-guard shape
// as stress-display.ts's STRESS_DIAL_KEYS.
export const COMPANION_EFFECT_KINDS: readonly CompanionEffectKind[] = [
  "NITROGEN_FIX",
  "POLLINATOR_BOOST",
  "ALLELOPATHIC",
  "PREDATOR_ATTRACT",
];

export const COMPANION_EFFECT_LABEL: Record<CompanionEffectKind, string> = {
  NITROGEN_FIX: "Nitrogen boost",
  POLLINATOR_BOOST: "Pollinator boost",
  ALLELOPATHIC: "Growth suppression",
  PREDATOR_ATTRACT: "Attracts predators",
};

export const COMPANION_EFFECT_ICON: Record<CompanionEffectKind, LucideIcon> = {
  NITROGEN_FIX: Sprout,
  POLLINATOR_BOOST: Flower2,
  ALLELOPATHIC: OctagonAlert,
  PREDATOR_ATTRACT: Bug,
};

// Text carrier for the currently-aria-hidden "+N" companion badge (WCAG
// 1.4.1 — mirrors cellInfectionPhrase/bedPestPhrase in pest-display.ts).
export function cellCompanionEffectPhrase(effects: readonly SnapshotCompanionEffect[]): string | null {
  if (effects.length === 0) {
    return null;
  }
  return effects.map((effect) => COMPANION_EFFECT_LABEL[effect.kind].toLowerCase()).join(", ");
}
