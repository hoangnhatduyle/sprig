// Data-driven species config: a new species should only require a new row
// in SPECIES_SEEDS below, never new growth-engine code — see the
// architecture doc's §16. GDD thresholds are rough approximations from
// common university-extension "days to maturity"/soil-temp guidance, not
// lab data — §17 flags exactly this kind of number as what should
// eventually be validated against real horticultural references.

import type { GrowthHabit, PollinationDependency, PrismaClient, SpeciesProfile } from "@prisma/client";
import { SpeciesValidationError } from "./errors";

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
    key: "melon",
    displayName: "Melon",
    growthHabit: "VINING",
    baseTempC: 12,
    gddToGerminate: 45,
    gddToVegetative: 170,
    gddToFlowering: 350,
    gddToFruiting: 500,
    gddToMaturity: 850,
    heatStressThresholdC: 35,
    coldStressThresholdC: 13,
    droughtComfortFraction: 0.55,
    matureHeightCm: 30,
    canopyWidthCm: 120,
    primaryColor: "#5a9c3f",
    pollinationDependency: "INSECT",
  },
  {
    key: "summer-squash",
    displayName: "Summer Squash",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 12,
    gddToGerminate: 40,
    gddToVegetative: 140,
    gddToFlowering: 280,
    gddToFruiting: 380,
    gddToMaturity: 550,
    heatStressThresholdC: 34,
    coldStressThresholdC: 12,
    droughtComfortFraction: 0.55,
    matureHeightCm: 60,
    canopyWidthCm: 90,
    primaryColor: "#4a8f2f",
    pollinationDependency: "INSECT",
  },
  {
    key: "pumpkin",
    displayName: "Pumpkin",
    growthHabit: "VINING",
    baseTempC: 13,
    gddToGerminate: 50,
    gddToVegetative: 200,
    gddToFlowering: 450,
    gddToFruiting: 650,
    gddToMaturity: 1200,
    heatStressThresholdC: 32,
    coldStressThresholdC: 13,
    droughtComfortFraction: 0.55,
    matureHeightCm: 40,
    canopyWidthCm: 180,
    primaryColor: "#3f7a2e",
    pollinationDependency: "INSECT",
  },
  {
    key: "spinach",
    displayName: "Spinach",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 2,
    gddToGerminate: 15,
    gddToVegetative: 80,
    gddToFlowering: 700,
    gddToFruiting: 750,
    gddToMaturity: 280,
    heatStressThresholdC: 21,
    coldStressThresholdC: 0,
    droughtComfortFraction: 0.5,
    matureHeightCm: 15,
    canopyWidthCm: 20,
    primaryColor: "#2f6b3f",
    lightNeedFraction: 0.45,
  },
  {
    key: "kale",
    displayName: "Kale",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 3,
    gddToGerminate: 30,
    gddToVegetative: 150,
    gddToFlowering: 1000,
    gddToFruiting: 1050,
    gddToMaturity: 550,
    heatStressThresholdC: 27,
    coldStressThresholdC: -2,
    droughtComfortFraction: 0.5,
    matureHeightCm: 45,
    canopyWidthCm: 40,
    primaryColor: "#3f7a4f",
    lightNeedFraction: 0.5,
  },
  {
    key: "chard",
    displayName: "Swiss Chard",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 4,
    gddToGerminate: 35,
    gddToVegetative: 160,
    gddToFlowering: 1100,
    gddToFruiting: 1150,
    gddToMaturity: 500,
    heatStressThresholdC: 30,
    coldStressThresholdC: 1,
    droughtComfortFraction: 0.5,
    matureHeightCm: 40,
    canopyWidthCm: 35,
    primaryColor: "#5a8f3a",
    lightNeedFraction: 0.45,
  },
  {
    key: "dill",
    displayName: "Dill",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 7,
    gddToGerminate: 45,
    gddToVegetative: 160,
    gddToFlowering: 320,
    gddToFruiting: 380,
    gddToMaturity: 550,
    heatStressThresholdC: 32,
    coldStressThresholdC: 4,
    droughtComfortFraction: 0.45,
    matureHeightCm: 90,
    canopyWidthCm: 30,
    primaryColor: "#6fa848",
  },
  {
    key: "nasturtium",
    displayName: "Nasturtium",
    growthHabit: "VINING",
    baseTempC: 8,
    gddToGerminate: 50,
    gddToVegetative: 150,
    gddToFlowering: 280,
    gddToFruiting: 320,
    gddToMaturity: 480,
    heatStressThresholdC: 33,
    coldStressThresholdC: 5,
    droughtComfortFraction: 0.35,
    matureHeightCm: 25,
    canopyWidthCm: 60,
    primaryColor: "#d9822b",
    pollinationDependency: "INSECT",
  },
  {
    key: "radish",
    displayName: "Radish",
    growthHabit: "ROOT_CROP",
    baseTempC: 4,
    gddToGerminate: 40,
    gddToVegetative: 120,
    gddToFlowering: 1200,
    gddToFruiting: 1250,
    gddToMaturity: 280,
    heatStressThresholdC: 25,
    coldStressThresholdC: 0,
    droughtComfortFraction: 0.5,
    matureHeightCm: 15,
    canopyWidthCm: 12,
    primaryColor: "#4f8a3d",
    lightNeedFraction: 0.45,
  },
  {
    key: "beet",
    displayName: "Beet",
    growthHabit: "ROOT_CROP",
    baseTempC: 4,
    gddToGerminate: 55,
    gddToVegetative: 200,
    gddToFlowering: 1400,
    gddToFruiting: 1450,
    gddToMaturity: 800,
    heatStressThresholdC: 27,
    coldStressThresholdC: 0,
    droughtComfortFraction: 0.5,
    matureHeightCm: 30,
    canopyWidthCm: 20,
    primaryColor: "#7a3f3a",
  },
  {
    key: "turnip",
    displayName: "Turnip",
    growthHabit: "ROOT_CROP",
    baseTempC: 4,
    gddToGerminate: 40,
    gddToVegetative: 150,
    gddToFlowering: 1300,
    gddToFruiting: 1350,
    gddToMaturity: 550,
    heatStressThresholdC: 26,
    coldStressThresholdC: -1,
    droughtComfortFraction: 0.5,
    matureHeightCm: 25,
    canopyWidthCm: 20,
    primaryColor: "#4f8a3d",
  },
  {
    // Cool-season, frost-hardy (unlike pole-bean's warm-season baseTempC 10)
    // — peas are traditionally planted weeks before the last frost.
    key: "pea",
    displayName: "Pea",
    growthHabit: "VINING",
    baseTempC: 5,
    gddToGerminate: 45,
    gddToVegetative: 170,
    gddToFlowering: 380,
    gddToFruiting: 480,
    gddToMaturity: 650,
    heatStressThresholdC: 25,
    coldStressThresholdC: -2,
    droughtComfortFraction: 0.5,
    matureHeightCm: 150,
    canopyWidthCm: 25,
    primaryColor: "#4a8f4a",
    pollinationDependency: "SELF",
  },
  {
    key: "cabbage",
    displayName: "Cabbage",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 3,
    gddToGerminate: 40,
    gddToVegetative: 250,
    gddToFlowering: 1300,
    gddToFruiting: 1350,
    gddToMaturity: 900,
    heatStressThresholdC: 27,
    coldStressThresholdC: -2,
    droughtComfortFraction: 0.5,
    matureHeightCm: 35,
    canopyWidthCm: 45,
    primaryColor: "#5a8a5a",
    lightNeedFraction: 0.55,
  },
  {
    key: "broccoli",
    displayName: "Broccoli",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 3,
    gddToGerminate: 40,
    gddToVegetative: 220,
    gddToFlowering: 550,
    gddToFruiting: 600,
    gddToMaturity: 700,
    heatStressThresholdC: 26,
    coldStressThresholdC: -2,
    droughtComfortFraction: 0.5,
    matureHeightCm: 60,
    canopyWidthCm: 50,
    primaryColor: "#4f7a4f",
  },
  {
    key: "cauliflower",
    displayName: "Cauliflower",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 3,
    gddToGerminate: 45,
    gddToVegetative: 250,
    gddToFlowering: 600,
    gddToFruiting: 650,
    gddToMaturity: 800,
    heatStressThresholdC: 25,
    coldStressThresholdC: -1,
    droughtComfortFraction: 0.5,
    matureHeightCm: 55,
    canopyWidthCm: 55,
    primaryColor: "#5a8a5a",
  },
  {
    key: "brussels-sprouts",
    displayName: "Brussels Sprouts",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 3,
    gddToGerminate: 45,
    gddToVegetative: 300,
    gddToFlowering: 1300,
    gddToFruiting: 1350,
    gddToMaturity: 1100,
    heatStressThresholdC: 24,
    coldStressThresholdC: -3,
    droughtComfortFraction: 0.5,
    matureHeightCm: 80,
    canopyWidthCm: 45,
    primaryColor: "#4f7a4f",
  },
  {
    key: "onion",
    displayName: "Onion",
    growthHabit: "ROOT_CROP",
    baseTempC: 2,
    gddToGerminate: 60,
    gddToVegetative: 300,
    gddToFlowering: 1600,
    gddToFruiting: 1650,
    gddToMaturity: 1000,
    heatStressThresholdC: 30,
    coldStressThresholdC: -3,
    droughtComfortFraction: 0.45,
    matureHeightCm: 40,
    canopyWidthCm: 15,
    primaryColor: "#5a8a4a",
    lightNeedFraction: 0.5,
  },
  {
    key: "garlic",
    displayName: "Garlic",
    growthHabit: "ROOT_CROP",
    baseTempC: 1,
    gddToGerminate: 70,
    gddToVegetative: 400,
    gddToFlowering: 1700,
    gddToFruiting: 1750,
    gddToMaturity: 1300,
    heatStressThresholdC: 29,
    coldStressThresholdC: -5,
    droughtComfortFraction: 0.4,
    matureHeightCm: 50,
    canopyWidthCm: 12,
    primaryColor: "#5a8a4a",
    lightNeedFraction: 0.5,
  },
  {
    key: "corn",
    displayName: "Sweet Corn",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 10,
    gddToGerminate: 50,
    gddToVegetative: 350,
    gddToFlowering: 700,
    gddToFruiting: 850,
    gddToMaturity: 1250,
    heatStressThresholdC: 35,
    coldStressThresholdC: 8,
    droughtComfortFraction: 0.55,
    matureHeightCm: 200,
    canopyWidthCm: 40,
    primaryColor: "#5a9c3a",
    pollinationDependency: "WIND",
  },
  {
    key: "potato",
    displayName: "Potato",
    growthHabit: "ROOT_CROP",
    baseTempC: 7,
    gddToGerminate: 80,
    gddToVegetative: 350,
    gddToFlowering: 600,
    gddToFruiting: 650,
    gddToMaturity: 1000,
    heatStressThresholdC: 29,
    coldStressThresholdC: 2,
    droughtComfortFraction: 0.55,
    matureHeightCm: 60,
    canopyWidthCm: 45,
    primaryColor: "#4f8a3d",
  },
  {
    key: "eggplant",
    displayName: "Eggplant",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 13,
    gddToGerminate: 65,
    gddToVegetative: 250,
    gddToFlowering: 550,
    gddToFruiting: 800,
    gddToMaturity: 1400,
    heatStressThresholdC: 35,
    coldStressThresholdC: 14,
    droughtComfortFraction: 0.5,
    matureHeightCm: 75,
    canopyWidthCm: 50,
    primaryColor: "#5a4a7f",
    pollinationDependency: "SELF",
  },
  {
    key: "basil",
    displayName: "Basil",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 12,
    gddToGerminate: 50,
    gddToVegetative: 180,
    gddToFlowering: 400,
    gddToFruiting: 450,
    gddToMaturity: 500,
    heatStressThresholdC: 34,
    coldStressThresholdC: 13,
    droughtComfortFraction: 0.5,
    matureHeightCm: 45,
    canopyWidthCm: 30,
    primaryColor: "#4a8f4a",
  },
  {
    key: "sunflower",
    displayName: "Sunflower",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 6,
    gddToGerminate: 50,
    gddToVegetative: 400,
    gddToFlowering: 900,
    gddToFruiting: 950,
    gddToMaturity: 1100,
    heatStressThresholdC: 36,
    coldStressThresholdC: 3,
    droughtComfortFraction: 0.35,
    matureHeightCm: 200,
    canopyWidthCm: 45,
    primaryColor: "#d9a62b",
    pollinationDependency: "INSECT",
  },
  {
    key: "hot-pepper",
    displayName: "Hot Pepper",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 12,
    gddToGerminate: 65,
    gddToVegetative: 230,
    gddToFlowering: 520,
    gddToFruiting: 820,
    gddToMaturity: 1450,
    heatStressThresholdC: 35,
    coldStressThresholdC: 14,
    droughtComfortFraction: 0.45,
    matureHeightCm: 65,
    canopyWidthCm: 40,
    primaryColor: "#7a2e2b",
    // Hotter varieties (habanero/superhot types) run 90-180 days to maturity
    // vs. bell pepper's 70-85 — a longer, hardier curve, not just a recolor.
  },
  {
    key: "thai-eggplant",
    displayName: "Thai Eggplant (Cà Pháo)",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 14,
    gddToGerminate: 60,
    gddToVegetative: 220,
    gddToFlowering: 450,
    gddToFruiting: 600,
    gddToMaturity: 950,
    heatStressThresholdC: 36,
    coldStressThresholdC: 15,
    droughtComfortFraction: 0.45,
    matureHeightCm: 80,
    canopyWidthCm: 60,
    primaryColor: "#6a4a8a",
    pollinationDependency: "SELF",
    // Small-fruited, fast-maturing eggplant type (~2/3 of standard
    // eggplant's GDD curve) common in Southeast Asian gardens.
  },
  {
    key: "okra",
    displayName: "Okra (Đậu Bắp)",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 15,
    gddToGerminate: 60,
    gddToVegetative: 260,
    gddToFlowering: 480,
    gddToFruiting: 560,
    gddToMaturity: 900,
    heatStressThresholdC: 37,
    coldStressThresholdC: 15,
    droughtComfortFraction: 0.4,
    matureHeightCm: 180,
    canopyWidthCm: 60,
    primaryColor: "#4f8a3a",
    // Needs soil warmed above 80F to germinate — the highest baseTempC of
    // any warm-season fruiting crop here, and correspondingly heat/drought-
    // loving once established.
  },
  {
    key: "rosemary",
    displayName: "Rosemary",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 8,
    gddToGerminate: 70,
    gddToVegetative: 320,
    gddToFlowering: 650,
    gddToFruiting: 700,
    gddToMaturity: 900,
    heatStressThresholdC: 35,
    coldStressThresholdC: -5,
    droughtComfortFraction: 0.3,
    matureHeightCm: 120,
    canopyWidthCm: 90,
    primaryColor: "#6f8f6a",
    windLodgingThresholdKph: 55,
    // Woody Mediterranean perennial — the most drought-tolerant and
    // cold-hardy species in the catalog, and never lodges.
  },
  {
    key: "perilla",
    displayName: "Perilla (Tía Tô)",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 11,
    gddToGerminate: 55,
    gddToVegetative: 190,
    gddToFlowering: 420,
    gddToFruiting: 460,
    gddToMaturity: 560,
    heatStressThresholdC: 34,
    coldStressThresholdC: 12,
    droughtComfortFraction: 0.45,
    matureHeightCm: 75,
    canopyWidthCm: 35,
    primaryColor: "#6a3a5a",
  },
  {
    key: "hoary-basil",
    displayName: "Hoary Basil (Lá É)",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 13,
    gddToGerminate: 55,
    gddToVegetative: 190,
    gddToFlowering: 380,
    gddToFruiting: 430,
    gddToMaturity: 480,
    heatStressThresholdC: 36,
    coldStressThresholdC: 14,
    droughtComfortFraction: 0.4,
    matureHeightCm: 45,
    canopyWidthCm: 30,
    primaryColor: "#5a9c5a",
  },
  {
    key: "vietnamese-coriander",
    displayName: "Vietnamese Coriander (Rau Răm)",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 14,
    gddToGerminate: 60,
    gddToVegetative: 220,
    gddToFlowering: 1200,
    gddToFruiting: 1250,
    gddToMaturity: 420,
    heatStressThresholdC: 37,
    coldStressThresholdC: 16,
    droughtComfortFraction: 0.6,
    matureHeightCm: 40,
    canopyWidthCm: 45,
    primaryColor: "#4a7a4f",
    lightNeedFraction: 0.45,
    // Tropical spreading perennial (zones 9-11) — the highest drought-
    // comfort fraction and cold-stress threshold in the catalog: it wants
    // consistently moist soil and is damaged by the lightest chill.
  },
  {
    key: "cilantro",
    displayName: "Cilantro",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 3,
    gddToGerminate: 20,
    gddToVegetative: 90,
    gddToFlowering: 280,
    gddToFruiting: 330,
    gddToMaturity: 220,
    heatStressThresholdC: 23,
    coldStressThresholdC: -1,
    droughtComfortFraction: 0.55,
    matureHeightCm: 45,
    canopyWidthCm: 25,
    primaryColor: "#4f8f4a",
    lightNeedFraction: 0.45,
    // Bolts almost as soon as it hits real heat — the lowest heat-stress
    // threshold of any leafy herb here, harvested (like lettuce) well
    // before it would ever reach flowering.
  },
  {
    key: "celery-leaf",
    displayName: "Celery Leaf",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 5,
    gddToGerminate: 45,
    gddToVegetative: 220,
    gddToFlowering: 1200,
    gddToFruiting: 1250,
    gddToMaturity: 520,
    heatStressThresholdC: 26,
    coldStressThresholdC: -1,
    droughtComfortFraction: 0.55,
    matureHeightCm: 40,
    canopyWidthCm: 30,
    primaryColor: "#4f8a4f",
    lightNeedFraction: 0.45,
  },
  {
    key: "green-onion",
    displayName: "Green Onion",
    growthHabit: "ROOT_CROP",
    baseTempC: 2,
    gddToGerminate: 50,
    gddToVegetative: 150,
    gddToFlowering: 1400,
    gddToFruiting: 1450,
    gddToMaturity: 450,
    heatStressThresholdC: 28,
    coldStressThresholdC: -5,
    droughtComfortFraction: 0.45,
    matureHeightCm: 35,
    canopyWidthCm: 8,
    primaryColor: "#5a9c4a",
    lightNeedFraction: 0.5,
    // Harvested green well before bulbing — same allium base temp as onion
    // but a fraction of its maturity GDD.
  },
  {
    key: "shallot",
    displayName: "Shallot",
    growthHabit: "ROOT_CROP",
    baseTempC: 2,
    gddToGerminate: 55,
    gddToVegetative: 260,
    gddToFlowering: 1500,
    gddToFruiting: 1550,
    gddToMaturity: 850,
    heatStressThresholdC: 29,
    coldStressThresholdC: -3,
    droughtComfortFraction: 0.45,
    matureHeightCm: 40,
    canopyWidthCm: 15,
    primaryColor: "#5a8a4a",
    lightNeedFraction: 0.5,
  },
  {
    key: "gourd",
    displayName: "Gourd (Bầu)",
    growthHabit: "VINING",
    baseTempC: 13,
    gddToGerminate: 55,
    gddToVegetative: 220,
    gddToFlowering: 480,
    gddToFruiting: 700,
    gddToMaturity: 1300,
    heatStressThresholdC: 36,
    coldStressThresholdC: 14,
    droughtComfortFraction: 0.55,
    matureHeightCm: 40,
    canopyWidthCm: 200,
    primaryColor: "#3f8a3a",
    pollinationDependency: "INSECT",
    windLodgingThresholdKph: 38,
    // Bottle-gourd-type vine — the most vigorous canopy spread and longest
    // maturity of the squash-family vines, needing sturdy trellising like
    // pumpkin.
  },
  {
    key: "chayote",
    displayName: "Chayote",
    growthHabit: "VINING",
    baseTempC: 14,
    gddToGerminate: 90,
    gddToVegetative: 350,
    gddToFlowering: 900,
    gddToFruiting: 1000,
    gddToMaturity: 1500,
    heatStressThresholdC: 35,
    coldStressThresholdC: 13,
    droughtComfortFraction: 0.55,
    matureHeightCm: 50,
    canopyWidthCm: 250,
    primaryColor: "#3a7a2f",
    pollinationDependency: "INSECT",
    windLodgingThresholdKph: 35,
    // The longest season and largest canopy footprint in the catalog — a
    // perennial vine grown as an annual, traditionally planted from the
    // whole fruit rather than seed.
  },
  {
    key: "malabar-spinach",
    displayName: "Malabar Spinach (Mồng Tơi)",
    growthHabit: "VINING",
    baseTempC: 15,
    gddToGerminate: 60,
    gddToVegetative: 220,
    gddToFlowering: 750,
    gddToFruiting: 800,
    gddToMaturity: 600,
    heatStressThresholdC: 38,
    coldStressThresholdC: 17,
    droughtComfortFraction: 0.55,
    matureHeightCm: 250,
    canopyWidthCm: 60,
    primaryColor: "#3f7a3f",
    windLodgingThresholdKph: 35,
    // The tropical opposite of true spinach: thrives in heat/humidity where
    // spinach would bolt, and needs the warmest soil of any leafy green
    // here to germinate at all. Picked continuously for leaves, so
    // maturity is reachable well before it would ever fruit — same
    // unreachable-fruiting pattern as spinach/chard above, despite the
    // vining habit.
  },
  {
    key: "amaranth-greens",
    displayName: "Amaranth Greens (Rau Dền)",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 14,
    gddToGerminate: 45,
    gddToVegetative: 160,
    gddToFlowering: 900,
    gddToFruiting: 950,
    gddToMaturity: 420,
    heatStressThresholdC: 38,
    coldStressThresholdC: 12,
    droughtComfortFraction: 0.35,
    matureHeightCm: 50,
    canopyWidthCm: 30,
    primaryColor: "#6a8a3f",
    lightNeedFraction: 0.55,
    // A warm-season leafy green that mirrors spinach/chard: thrives past
    // 35C where those cool-season greens would already be stressed.
  },
  {
    key: "yu-choy",
    displayName: "Yu Choy (Choy Sum)",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 4,
    gddToGerminate: 35,
    gddToVegetative: 140,
    gddToFlowering: 260,
    gddToFruiting: 300,
    gddToMaturity: 340,
    heatStressThresholdC: 27,
    coldStressThresholdC: -2,
    droughtComfortFraction: 0.5,
    matureHeightCm: 35,
    canopyWidthCm: 25,
    primaryColor: "#5a9c4a",
    lightNeedFraction: 0.5,
    // Unlike the other brassicas here, yu choy is harvested WITH its
    // flowering stems, so gddToFlowering is deliberately reachable rather
    // than pushed out of reach like cabbage/broccoli's bolt-avoidance
    // pattern.
  },
  {
    key: "bok-choy",
    displayName: "Bok Choy",
    growthHabit: "ROSETTE_LEAFY",
    baseTempC: 3,
    gddToGerminate: 35,
    gddToVegetative: 180,
    gddToFlowering: 1200,
    gddToFruiting: 1250,
    gddToMaturity: 480,
    heatStressThresholdC: 27,
    coldStressThresholdC: -2,
    droughtComfortFraction: 0.5,
    matureHeightCm: 28,
    canopyWidthCm: 25,
    primaryColor: "#5a9c5a",
    lightNeedFraction: 0.5,
  },
  {
    key: "cosmos",
    displayName: "Cosmos",
    growthHabit: "UPRIGHT_BUSH",
    baseTempC: 8,
    gddToGerminate: 40,
    gddToVegetative: 160,
    gddToFlowering: 340,
    gddToFruiting: 370,
    gddToMaturity: 550,
    heatStressThresholdC: 36,
    coldStressThresholdC: 2,
    droughtComfortFraction: 0.3,
    matureHeightCm: 120,
    canopyWidthCm: 45,
    primaryColor: "#d9668f",
    pollinationDependency: "INSECT",
    windLodgingThresholdKph: 32,
    lightNeedFraction: 0.55,
    // Ornamental border annual — tall and thin-stemmed, so the lowest wind-
    // lodging threshold of any upright species, but among the most
    // heat/drought-tolerant once established (same territory as rosemary
    // above).
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
  // Placed ahead of the broader existing rules below (e.g. generic
  // pepper|chili, eggplant, spinach) since Array.find takes the first
  // match — these more specific patterns must win before the catch-alls
  // they'd otherwise be swallowed by.
  { pattern: /hot pepper|chili|chilli|chile|jalape|habanero|serrano|cayenne|super chili/i, key: "hot-pepper" },
  { pattern: /thai eggplant|cà pháo|ca phao|pea eggplant/i, key: "thai-eggplant" },
  { pattern: /okra|đậu bắp|dau bap/i, key: "okra" },
  { pattern: /rosemary/i, key: "rosemary" },
  { pattern: /perilla|shiso|tía tô|tia to/i, key: "perilla" },
  { pattern: /hoary basil|lemon basil|lá é|rau é/i, key: "hoary-basil" },
  { pattern: /vietnamese coriander|rau răm|rau ram/i, key: "vietnamese-coriander" },
  { pattern: /cilantro|coriander/i, key: "cilantro" },
  { pattern: /celery leaf|leaf celery|chinese celery|celery/i, key: "celery-leaf" },
  { pattern: /green onion|spring onion|scallion|hành lá/i, key: "green-onion" },
  { pattern: /shallot|hành tím/i, key: "shallot" },
  { pattern: /gourd|bầu/i, key: "gourd" },
  { pattern: /chayote|choko|su su|susu/i, key: "chayote" },
  { pattern: /malabar spinach|mồng tơi|mong toi/i, key: "malabar-spinach" },
  { pattern: /amaranth|rau dền|rau den/i, key: "amaranth-greens" },
  { pattern: /yu choy|choy sum|yuchoy/i, key: "yu-choy" },
  { pattern: /bok choy|bokchoy|pak choi|paksoi/i, key: "bok-choy" },
  { pattern: /cosmos/i, key: "cosmos" },
  { pattern: /tomato/i, key: "tomato" },
  { pattern: /pepper|chili|chilli/i, key: "bell-pepper" },
  { pattern: /eggplant|aubergine/i, key: "eggplant" },
  { pattern: /potato/i, key: "potato" },
  { pattern: /\bcorn\b|maize/i, key: "corn" },
  { pattern: /cucumber/i, key: "cucumber" },
  { pattern: /melon|cantaloupe|honeydew/i, key: "melon" },
  { pattern: /pumpkin/i, key: "pumpkin" },
  { pattern: /squash|zucchini|courgette/i, key: "summer-squash" },
  { pattern: /spinach/i, key: "spinach" },
  { pattern: /kale/i, key: "kale" },
  { pattern: /chard/i, key: "chard" },
  { pattern: /lettuce|greens?/i, key: "lettuce" },
  { pattern: /cabbage/i, key: "cabbage" },
  { pattern: /broccoli/i, key: "broccoli" },
  { pattern: /cauliflower/i, key: "cauliflower" },
  { pattern: /brussels/i, key: "brussels-sprouts" },
  { pattern: /dill/i, key: "dill" },
  { pattern: /nasturtium/i, key: "nasturtium" },
  { pattern: /marigold/i, key: "marigold" },
  { pattern: /sunflower/i, key: "sunflower" },
  { pattern: /basil/i, key: "basil" },
  { pattern: /radish/i, key: "radish" },
  { pattern: /beet(root)?/i, key: "beet" },
  { pattern: /turnip/i, key: "turnip" },
  { pattern: /carrot/i, key: "carrot" },
  { pattern: /onion/i, key: "onion" },
  { pattern: /garlic/i, key: "garlic" },
  { pattern: /pea(s)?\b/i, key: "pea" },
  { pattern: /bean/i, key: "pole-bean" },
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

export interface SpeciesProfileSummary {
  id: string;
  key: string;
  displayName: string;
  growthHabit: GrowthHabit;
}

// Backs the species picker (InventoryPanel.tsx) — the searchable catalog UI
// this data-driven design (§16) exists to enable.
export async function listSpeciesProfiles(prisma: PrismaClient): Promise<SpeciesProfileSummary[]> {
  await ensureSpeciesCatalogSeeded(prisma);
  return prisma.speciesProfile.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, key: true, displayName: true, growthHabit: true },
  });
}

// Every SpeciesProfile field a user can set when hand-authoring a species
// the built-in catalog doesn't cover, minus the ones the system owns
// (`id`, `plants`, `key` — derived from displayName, `isFallbackDefault` —
// never true for a user-created species). Fields with a schema default are
// optional here too, same as SpeciesSeed above.
export interface CustomSpeciesInput {
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
  matureHeightCm: number;
  canopyWidthCm: number;
  primaryColor: string;
  droughtComfortFraction?: number;
  lightNeedFraction?: number;
  baseNutrientDemand?: number;
  windLodgingThresholdKph?: number;
  pollinationDependency?: PollinationDependency;
  diseaseResistanceTrait?: number;
}

function slugifySpeciesKey(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "species";
}

// `key` is @unique — collisions (e.g. two custom species named "Roma") get
// a numeric suffix rather than failing the create.
async function uniqueSpeciesKey(prisma: PrismaClient, displayName: string): Promise<string> {
  const base = slugifySpeciesKey(displayName);
  let candidate = base;
  let suffix = 2;
  while (await prisma.speciesProfile.findUnique({ where: { key: candidate } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function validateCustomSpeciesInput(input: CustomSpeciesInput): void {
  if (!input.displayName.trim()) {
    throw new SpeciesValidationError("Display name is required.");
  }
  const requiredNumericFields: ReadonlyArray<[string, number]> = [
    ["Base temperature", input.baseTempC],
    ["GDD to germinate", input.gddToGerminate],
    ["GDD to vegetative", input.gddToVegetative],
    ["GDD to flowering", input.gddToFlowering],
    ["GDD to fruiting", input.gddToFruiting],
    ["GDD to maturity", input.gddToMaturity],
    ["Heat stress threshold", input.heatStressThresholdC],
    ["Cold stress threshold", input.coldStressThresholdC],
    ["Mature height", input.matureHeightCm],
    ["Canopy width", input.canopyWidthCm],
  ];
  for (const [label, value] of requiredNumericFields) {
    if (!Number.isFinite(value)) {
      throw new SpeciesValidationError(`${label} must be a number.`);
    }
  }
  if (input.heatStressThresholdC <= input.coldStressThresholdC) {
    throw new SpeciesValidationError("Heat stress threshold must be greater than cold stress threshold.");
  }
  if (input.matureHeightCm <= 0) {
    throw new SpeciesValidationError("Mature height must be greater than zero.");
  }
  if (input.canopyWidthCm <= 0) {
    throw new SpeciesValidationError("Canopy width must be greater than zero.");
  }
  if (
    !(input.gddToGerminate > 0) ||
    !(input.gddToVegetative > 0) ||
    !(input.gddToFruiting > 0) ||
    !(input.gddToMaturity > 0)
  ) {
    throw new SpeciesValidationError("Growth stage thresholds must be greater than zero.");
  }
  // gddToFlowering is deliberately exempt from this ordering — root/leaf
  // crops (carrot, cabbage above) are harvested before flowering, so their
  // seed data sets it arbitrarily high rather than in sequence.
  if (
    !(input.gddToGerminate < input.gddToVegetative) ||
    !(input.gddToVegetative < input.gddToFruiting) ||
    !(input.gddToFruiting < input.gddToMaturity)
  ) {
    throw new SpeciesValidationError(
      "Growth stage thresholds must increase in order: germinate, vegetative, fruiting, maturity.",
    );
  }
  const fractionFields: ReadonlyArray<[string, number | undefined]> = [
    ["Drought comfort fraction", input.droughtComfortFraction],
    ["Light need fraction", input.lightNeedFraction],
    ["Disease resistance trait", input.diseaseResistanceTrait],
  ];
  for (const [label, value] of fractionFields) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new SpeciesValidationError(`${label} must be between 0 and 1.`);
    }
  }
  if (!/^#[0-9a-f]{6}$/i.test(input.primaryColor)) {
    throw new SpeciesValidationError("Primary color must be a hex value like #4a8f3a.");
  }
}

export async function createCustomSpeciesProfile(
  prisma: PrismaClient,
  input: CustomSpeciesInput,
): Promise<SpeciesProfile> {
  validateCustomSpeciesInput(input);
  const key = await uniqueSpeciesKey(prisma, input.displayName);
  return prisma.speciesProfile.create({
    data: {
      ...input,
      displayName: input.displayName.trim(),
      key,
      isFallbackDefault: false,
    },
  });
}
