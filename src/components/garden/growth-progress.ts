export type PhenologyStage =
  | "GERMINATING"
  | "VEGETATIVE"
  | "FLOWERING"
  | "FRUITING"
  | "MATURE"
  | "SENESCENT"
  | "DEAD";

// UI-layer mirror of growth-engine-service.ts's module-private
// nextPhenologyStage stage order (NC-SPRIG-GROWTH4-NO-ENGINE-CHANGE forbids
// touching that file, and the function isn't exported anyway) — same
// "local mirror over cross-domain import" precedent grid-cell-service.ts
// already sets for PhenologyStage at its own lines 383-389.
const STAGE_ORDER: PhenologyStage[] = ["GERMINATING", "VEGETATIVE", "FLOWERING", "FRUITING", "MATURE"];

export interface StageProgress {
  nextStage: PhenologyStage;
  fraction: number; // clamped [0,1]
}

// Named/exported per the same "narrower structural view over GrowthView"
// precedent as stress-display.ts's HealthBandInput.
export interface StageProgressInput {
  phenologyStage: PhenologyStage;
  accumulatedGdd: number;
  gddToVegetative: number;
  gddToFlowering: number;
  gddToFruiting: number;
  gddToMaturity: number;
}

export function stageProgress(input: StageProgressInput): StageProgress | null {
  if (input.phenologyStage === "MATURE" || input.phenologyStage === "SENESCENT" || input.phenologyStage === "DEAD") {
    return null; // terminal — AC-4
  }
  const thresholds: Record<PhenologyStage, number> = {
    GERMINATING: 0,
    VEGETATIVE: input.gddToVegetative,
    FLOWERING: input.gddToFlowering,
    FRUITING: input.gddToFruiting,
    MATURE: input.gddToMaturity,
    SENESCENT: input.gddToMaturity,
    DEAD: input.gddToMaturity,
  };
  const currentIndex = STAGE_ORDER.indexOf(input.phenologyStage);
  const nextStage = STAGE_ORDER[currentIndex + 1];
  if (!nextStage) {
    return null;
  }
  const currentThreshold = thresholds[input.phenologyStage];
  const nextThreshold = thresholds[nextStage];
  const span = nextThreshold - currentThreshold;
  // Guard divide-by-zero/inverted thresholds AND a non-finite accumulatedGdd
  // (e.g. corrupted upstream data) — clamp rather than propagate NaN/Infinity
  // (AC-4's "never NaN").
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(input.accumulatedGdd)) {
    return { nextStage, fraction: 1 };
  }
  const raw = (input.accumulatedGdd - currentThreshold) / span;
  return { nextStage, fraction: Math.min(1, Math.max(0, raw)) };
}

export interface HeightEstimateInput {
  matureHeightCm: number;
  leafFraction: number;
  stemFraction: number;
  rootFraction: number;
}

export function estimatedHeightCm(input: HeightEstimateInput): number {
  const biomassFraction = Math.min(1, Math.max(0, input.leafFraction + input.stemFraction + input.rootFraction * 0.3));
  return input.matureHeightCm * biomassFraction;
}
