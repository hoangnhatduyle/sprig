// Curated companion-planting pair-effects (architecture doc §11). Config,
// not a DB table — mirrors species-catalog.ts's "config, not code that
// changes per species" philosophy, but scoped even smaller: a handful of
// hand-curated source species, not user-editable per-garden data, so a
// static array is the right amount of machinery (no seeding/CRUD needed).
//
// Each entry describes a SOURCE species that projects an effect onto
// nearby companions (ecology-service.ts resolves "nearby" via cell
// adjacency), not a strict pairwise combination table — this matches how
// the architecture doc itself frames every example (beans fix nitrogen for
// whichever neighbors happen to be planted nearby; marigold boosts
// pollinators for whichever neighbors happen to be insect-pollinated).
// `targetSpeciesKey` exists for the one kind (ALLELOPATHIC) that really is
// pair-specific, but is left unseeded — the current catalog
// (species-catalog.ts) has no antagonistic pair to seed yet.

// PREDATOR_ATTRACT (Phase 3, SPEC-GROWTH-003): a flowering "insectary"
// companion boosting beneficial-predator immigration in
// src/domain/pests/pest-service.ts — the architecture doc's §10/§11
// "marigold, dill" example.
export type CompanionEffectKind = "NITROGEN_FIX" | "POLLINATOR_BOOST" | "ALLELOPATHIC" | "PREDATOR_ATTRACT";

export interface CompanionEffectSource {
  speciesKey: string;
  kind: CompanionEffectKind;
  magnitude: number;
  targetSpeciesKey?: string;
}

export const COMPANION_EFFECT_SOURCES: readonly CompanionEffectSource[] = [
  // A nitrogen-fixing legume trickles a small daily nitrogen bonus into its
  // own and neighboring cells' soil — real permaculture mechanic (§11).
  { speciesKey: "pole-bean", kind: "NITROGEN_FIX", magnitude: 0.03 },
  // Marigold is the architecture doc's own worked example of an "insectary"
  // companion: it boosts pollinator activity for nearby insect-dependent
  // species (§10/§11), which is what makes cucumber's INSECT
  // pollinationDependency (species-catalog.ts) a demonstrable feature
  // rather than an inert config flag.
  { speciesKey: "marigold", kind: "POLLINATOR_BOOST", magnitude: 0.35 },
  // The SAME insectary flower also attracts predatory/beneficial insects
  // (real permaculture double-duty, architecture doc §10/§11) — a second
  // source entry for marigold rather than folding this into
  // POLLINATOR_BOOST, since pollinators and predators are ecologically (and
  // mechanically, in pest-service.ts) distinct populations.
  { speciesKey: "marigold", kind: "PREDATOR_ATTRACT", magnitude: 0.4 },
  // pea split out of the pole-bean keyword bucket (species-catalog.ts) but
  // is the same nitrogen-fixing legume mechanic.
  { speciesKey: "pea", kind: "NITROGEN_FIX", magnitude: 0.03 },
  // dill split out of the marigold keyword bucket — same insectary
  // predator-attracting flower behavior.
  { speciesKey: "dill", kind: "PREDATOR_ATTRACT", magnitude: 0.3 },
  // nasturtium split out of the marigold keyword bucket — same insectary
  // pollinator-boosting flower behavior.
  { speciesKey: "nasturtium", kind: "POLLINATOR_BOOST", magnitude: 0.3 },
];

export function companionEffectsForSpecies(speciesKey: string): readonly CompanionEffectSource[] {
  return COMPANION_EFFECT_SOURCES.filter((entry) => entry.speciesKey === speciesKey);
}
