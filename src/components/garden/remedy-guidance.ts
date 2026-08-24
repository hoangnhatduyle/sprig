// Real-world remedy guidance per stress dial (stress-display.ts's
// STRESS_DIAL_KEYS), plus — where one actually exists — the matching in-app
// action. Verified against src/app/actions.ts and src/domain/: cold, wind,
// and transplantShock have no in-app remedy mechanism anywhere in this
// codebase, so those three intentionally carry `action: null` rather than a
// button that pretends to fix something the simulation can't.
//
// pestDisease is conditionally actionable: the dial itself is
// Math.max(disease severity, pest pressure) (daily-step-orchestrator.ts) and
// can't tell you which one dominated, so getRemedy() takes the same
// hasActiveInfection check bed-summary.ts already does per cell to pick the
// right variant instead of guessing.

import { STRESS_DIAL_KEYS } from "./stress-display";

export type RemedyAction =
  | { kind: "water" }
  | { kind: "shade-cloth" }
  | { kind: "grow-light" }
  | { kind: "fertilize" }
  | { kind: "fungicide" }
  | { kind: "open-irrigation" };

export interface StressRemedy {
  headline: string;
  steps: string[];
  action: RemedyAction | null;
}

// Same default ConditionsPanel.tsx seeds its own install-intensity slider
// with — reused here so a one-click install matches what "installing shade
// cloth/grow light" already means elsewhere in the app.
export const REMEDY_CONDITION_INTENSITY = 0.4;

// Modest organic application — enough to matter, deliberately not
// species-tuned (that's what the full fertilizer form in CellPicker is for).
export const REMEDY_FERTILIZER_NPK = { n: 0.1, p: 0.1, k: 0.1 } as const;

const PEST_DISEASE_WITH_INFECTION: StressRemedy = {
  headline: "Treat the infection",
  steps: [
    "Remove visibly infected leaves and dispose of them away from the bed.",
    "Improve airflow around the plant — thin crowded foliage if needed.",
    "Treat with an organic copper or neem-based fungicide.",
  ],
  action: { kind: "fungicide" },
};

const PEST_DISEASE_PEST_ONLY: StressRemedy = {
  headline: "Manage pest pressure",
  steps: [
    "Inspect the undersides of leaves for pests.",
    "Open the Pest panel (What-if Planner tab) to release beneficial predators or apply a targeted pesticide.",
  ],
  action: null,
};

type NonPestDiseaseDial = Exclude<(typeof STRESS_DIAL_KEYS)[number], "pestDisease">;

const REMEDY_BY_DIAL: Record<NonPestDiseaseDial, StressRemedy> = {
  drought: {
    headline: "Water this cell",
    steps: ["Check the soil about 2 inches down.", "If it's dry, water deeply at the base until the soil is moist."],
    action: { kind: "water" },
  },
  heat: {
    headline: "Shade the bed",
    steps: ["Install shade cloth over the bed during the hottest part of the day.", "Mulch around the base to keep roots cool."],
    action: { kind: "shade-cloth" },
  },
  shade: {
    headline: "Get it more light",
    steps: ["Move the planting to a sunnier spot if possible.", "Otherwise, supplement with a grow light for a few hours a day."],
    action: { kind: "grow-light" },
  },
  overwater: {
    headline: "Ease off watering",
    steps: [
      "Reduce or pause the watering schedule until the soil dries out.",
      "Switch to weather-aware irrigation scheduling so it skips rainy days.",
    ],
    action: { kind: "open-irrigation" },
  },
  nutrient: {
    headline: "Feed the plant",
    steps: ["Side-dress with a balanced organic fertilizer or compost.", "Water it in."],
    action: { kind: "fertilize" },
  },
  cold: {
    headline: "No in-app fix",
    steps: ["Use row covers or cold frames overnight if frost threatens.", "This resolves on its own as temperatures warm up."],
    action: null,
  },
  wind: {
    headline: "No in-app fix",
    steps: ["Stake tall plants or add a temporary windbreak.", "This resolves as wind conditions change."],
    action: null,
  },
  transplantShock: {
    headline: "No in-app fix",
    steps: [
      "Keep the soil consistently moist while new roots establish.",
      "Typically recovers within 1-2 weeks — no action needed beyond that.",
    ],
    action: null,
  },
};

// Falls back to "check the cell" (rather than pretending nothing's wrong)
// for a dial this map doesn't recognize — same defensive convention as
// stress-display.ts's STRESS_DIAL_LABEL[dial] ?? dial fallback, so a future
// 10th dial degrades gracefully instead of throwing.
const UNKNOWN_DIAL_REMEDY: StressRemedy = {
  headline: "Check this cell",
  steps: ["Open the cell for details on what's affecting it."],
  action: null,
};

function isNonPestDiseaseDial(dial: string): dial is NonPestDiseaseDial {
  return dial in REMEDY_BY_DIAL;
}

export function getRemedy(dial: string, hasActiveInfection: boolean): StressRemedy {
  if (dial === "pestDisease") {
    return hasActiveInfection ? PEST_DISEASE_WITH_INFECTION : PEST_DISEASE_PEST_ONLY;
  }
  if (isNonPestDiseaseDial(dial)) {
    return REMEDY_BY_DIAL[dial];
  }
  return UNKNOWN_DIAL_REMEDY;
}

// Cheap actionable check for banner tagging without needing the full
// StressRemedy — pestDisease is conditionally actionable, so this still
// takes hasActiveInfection rather than being a flat per-dial boolean table.
export function isDialActionable(dial: string, hasActiveInfection: boolean): boolean {
  return getRemedy(dial, hasActiveInfection).action !== null;
}
