// Data-driven species config: a new species should only require a new row
// in SPECIES_SEEDS below, never new growth-engine code — see the
// architecture doc's §16. GDD thresholds are rough approximations from
// common university-extension "days to maturity"/soil-temp guidance, not
// lab data — §17 flags exactly this kind of number as what should
// eventually be validated against real horticultural references.

import type { GrowthHabit, PollinationDependency, PrismaClient, SpeciesProfile } from "@prisma/client";

interface SpeciesSeed {
  key: string;
  displayName: string;
  growthHabit: GrowthHabit;
  baseTempC: number;
  gddToGerminate: number;
  gddToVegetative: number;
  gddToFlowering: number;
  gddToFruiting: number;
  gddToMaturity: number;
  heatStressThresholdC: number;
  coldStressThresholdC: number;
  droughtComfortFraction: number;
  matureHeightCm: number;
  canopyWidthCm: number;
  primaryColor: string;
  isFallbackDefault?: boolean;
  // --- Phase 2 (SPEC-GROWTH-002) --- optional: falls back to
  // SpeciesProfile's own schema defaults (a moderate, unremarkable plant)
  // when a seed doesn't specify them, same as the pre-Phase-2 fields above
  // never needed a "why is this omitted" justification for every species.
  lightNeedFraction?: number;
  windLodgingThresholdKph?: number;
  baseNutrientDemand?: number;
  pollinationDependency?: PollinationDependency;
}

export const FALLBACK_SPECIES_KEY = "generic-bush";

const SPECIES_SEEDS: readonly SpeciesSeed[] = [
  {
    key: "tomato",
    displayName: "Tomato",
    growthHabit: "VINING",
    baseTempC: 10,
    gddToGerminate: 50,
    gddToVegetative: 200,
    gddToFlowering: 450,
    gddToFruiting: 650,
    gddToMaturity: 1100,
    heatStressThresholdC: 32,
    coldStressThresholdC: 10,
    droughtComfortFraction: 0.55,
    matureHeightCm: 150,
    canopyWidthCm: 60,
    primaryColor: "#3f8f3a",
    // Real botany, and the architecture doc's own worked example (§11):
    // tomatoes are self-pollinating, so fruit-set is never gated on
    // pollinator activity. Tall and floppy on the vine — a lower lodging
    // threshold than the default.
    pollinationDependency: "SELF",
    windLodgingThresholdKph: 38,
  },
  {
    key: "bell-pepper",
    displayName: "Bell Pepper",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 12,
    gddToGerminate: 60,
    gddToVegetative: 220,
    gddToFlowering: 500,
    gddToFruiting: 750,
    gddToMaturity: 1300,
    heatStressThresholdC: 33,
    coldStressThresholdC: 13,
    droughtComfortFraction: 0.5,
    matureHeightCm: 60,
    canopyWidthCm: 45,
    primaryColor: "#4a8f3a",
  },
  {
    key: "cucumber",
    displayName: "Cucumber",
    growthHabit: "VINING",
    baseTempC: 12,
    gddToGerminate: 40,
    gddToVegetative: 150,
    gddToFlowering: 320,
    gddToFruiting: 450,
    gddToMaturity: 700,
    heatStressThresholdC: 32,
    coldStressThresholdC: 12,
    droughtComfortFraction: 0.6,
    matureHeightCm: 30,
    canopyWidthCm: 90,
    primaryColor: "#2f7a3a",
    // Real botany: cucumbers need insect pollination to set fruit — the
    // architecture doc's own worked example (§11) of a species whose
    // fruit-set is genuinely gated, paired with marigold as the
    // pollinator-boosting companion (companion-catalog.ts).
    pollinationDependency: "INSECT",
  },
  {
    key: "lettuce",
    displayName: "Lettuce",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 4,
    gddToGerminate: 20,
    gddToVegetative: 100,
    gddToFlowering: 900,
    gddToFruiting: 950,
    gddToMaturity: 350,
    heatStressThresholdC: 24,
    coldStressThresholdC: 2,
    droughtComfortFraction: 0.5,
    matureHeightCm: 20,
    canopyWidthCm: 25,
    primaryColor: "#6faf51",
    // Comparatively shade-tolerant — a real reason lettuce is a common
    // partial-shade interplant, and gives the shade stress dial
    // (stress-service.ts) a species that actually differs from the
    // full-sun-loving fruiting crops above.
    lightNeedFraction: 0.4,
  },
  {
    key: "marigold",
    displayName: "Marigold",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 8,
    gddToGerminate: 40,
    gddToVegetative: 150,
    gddToFlowering: 300,
    gddToFruiting: 320,
    gddToMaturity: 500,
    heatStressThresholdC: 34,
    coldStressThresholdC: 8,
    droughtComfortFraction: 0.4,
    matureHeightCm: 30,
    canopyWidthCm: 25,
    primaryColor: "#c98a2b",
    // The architecture doc's own worked "insectary companion" example
    // (§10/§11): companion-catalog.ts's POLLINATOR_BOOST source for this
    // key is what makes cucumber's INSECT pollinationDependency above a
    // demonstrable feature, not an inert config flag.
  },
  {
    key: "carrot",
    displayName: "Carrot",
    growthHabit: "ROOT_CROP",
    baseTempC: 4,
    gddToGerminate: 50,
    gddToVegetative: 180,
    // Root crops are usually harvested before flowering — GDD thresholds
    // set high enough that a normal-length season never reaches them, same
    // pattern lettuce (bolting) already uses for "not the point of growing
    // it" stages.
    gddToFlowering: 1400,
    gddToFruiting: 1450,
    gddToMaturity: 900,
    heatStressThresholdC: 26,
    coldStressThresholdC: 1,
    droughtComfortFraction: 0.5,
    matureHeightCm: 25,
    canopyWidthCm: 15,
    primaryColor: "#4f8a3d",
    lightNeedFraction: 0.45,
  },
  {
    key: "pole-bean",
    displayName: "Pole Bean",
    growthHabit: "VINING",
    baseTempC: 10,
    gddToGerminate: 45,
    gddToVegetative: 160,
    gddToFlowering: 380,
    gddToFruiting: 480,
    gddToMaturity: 750,
    heatStressThresholdC: 33,
    coldStressThresholdC: 10,
    droughtComfortFraction: 0.5,
    matureHeightCm: 200,
    canopyWidthCm: 30,
    primaryColor: "#3a7d3a",
    // The architecture doc's own "beans (nitrogen-fixer) -> slow local
    // soil-N bonus to neighbors" example (§11) — companion-catalog.ts's
    // NITROGEN_FIX source for this key is what makes it mechanically real,
    // not flavor text.
  },
  {
    key: FALLBACK_SPECIES_KEY,
    displayName: "Garden plant",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 8,
    gddToGerminate: 45,
    gddToVegetative: 180,
    gddToFlowering: 400,
    gddToFruiting: 600,
    gddToMaturity: 900,
    heatStressThresholdC: 30,
    coldStressThresholdC: 8,
    droughtComfortFraction: 0.5,
    matureHeightCm: 45,
    canopyWidthCm: 40,
    primaryColor: "#5e9c4f",
    isFallbackDefault: true,
  },
];

// Keyword heuristic: resolves a free-typed Plant.commonName to the closest
// seeded species so a brand-new species still gets a plausible growth
// habit/visual instead of hard-failing. Falls back to FALLBACK_SPECIES_KEY
// when nothing matches — this is the "a new species should only require
// editing configuration" guarantee from the architecture doc's §16.
const KEYWORD_MAP: ReadonlyArray<{ pattern: RegExp; key: string }> = [
  { pattern: /tomato/i, key: "tomato" },
  { pattern: /pepper|chili|chilli/i, key: "bell-pepper" },
  { pattern: /cucumber|melon|squash|zucchini|pumpkin/i, key: "cucumber" },
  { pattern: /lettuce|spinach|kale|chard|greens?/i, key: "lettuce" },
  { pattern: /marigold|dill|nasturtium/i, key: "marigold" },
  { pattern: /carrot|radish|beet|turnip/i, key: "carrot" },
  { pattern: /bean|pea/i, key: "pole-bean" },
];

export function guessSpeciesKey(commonName: string): string {
  const match = KEYWORD_MAP.find((entry) => entry.pattern.test(commonName));
  return match?.key ?? FALLBACK_SPECIES_KEY;
}

// Idempotent — safe to call on every read. Existing rows (matched by the
// unique `key`) are left untouched so hand-tuned values in a running garden
// are never clobbered by a redeploy; only genuinely missing seed species are
// inserted.
export async function ensureSpeciesCatalogSeeded(prisma: PrismaClient): Promise<void> {
  for (const seed of SPECIES_SEEDS) {
    await prisma.speciesProfile.upsert({
      where: { key: seed.key },
      update: {},
      create: seed,
    });
  }
}

// Self-healing: if the catalog was never seeded (a fresh DB that hasn't
// called ensureSpeciesCatalogSeeded yet), seed it now rather than throwing
// — the growth engine must always have SOME species to fall back to.
export async function getFallbackSpeciesProfile(prisma: PrismaClient): Promise<SpeciesProfile> {
  const fallback = await prisma.speciesProfile.findFirst({ where: { isFallbackDefault: true } });
  if (fallback) {
    return fallback;
  }
  await ensureSpeciesCatalogSeeded(prisma);
  return prisma.speciesProfile.findFirstOrThrow({ where: { isFallbackDefault: true } });
}

export async function resolveSpeciesProfileForName(
  prisma: PrismaClient,
  commonName: string,
): Promise<SpeciesProfile> {
  await ensureSpeciesCatalogSeeded(prisma);
  const key = guessSpeciesKey(commonName);
  return prisma.speciesProfile.findUniqueOrThrow({ where: { key } });
}
