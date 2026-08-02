// Pure translation from a bed's pest/predator populations
// (SnapshotPestPopulation/SnapshotPredatorPopulation, see
// grid-cell-service.ts) into particle parameters for PestSwarm.tsx's drei
// <Sparkles> instance — kept out of the component itself so it's
// unit-testable without a WebGL context, same rationale as
// weather-visuals.ts.

export interface PestSwarmVisualInput {
  pestKey: string;
  population: number;
}

export interface PredatorSwarmVisualInput {
  predatorKey: string;
  population: number;
}

export interface PestSwarmVisual {
  count: number;
  size: number;
  speed: number;
  color: string;
}

// A bed-scoped swarm, not the garden-wide rain field — a much smaller cap
// than weather-visuals.ts's 400, since this sits over one bed's footprint.
const MAX_SWARM_COUNT = 60;
// Below this, a swarm reads as visual noise rather than a signal — mirrors
// pest-display.ts's MIN_DISPLAY_POPULATION (kept as a separate literal
// here since this module must stay free of any component-layer import).
const MIN_VISIBLE_POPULATION = 0.15;

// Exported so Viewer3DLegend.tsx can render matching swatches without
// duplicating (and risking drift from) the actual particle colors below.
export const PEST_SWARM_COLOR = "#8a7a3f";
// Distinct, warmer red — ladybug-coded — so a predator swarm reads as its
// own signal at a glance rather than "more bugs" indistinguishable from
// the pests they're there to eat.
export const PREDATOR_SWARM_COLOR = "#c1392b";

function clampCount(value: number): number {
  return Math.max(0, Math.min(MAX_SWARM_COUNT, Math.round(value)));
}

// Shared by pestSwarmVisual/predatorSwarmVisual below: sums every entry's
// population into one swarm (every pest/predator sharing one cloud rather
// than a separate one per key — the point is "something is here," not a
// precise species count at a glance), null when the bed's total is below
// the display threshold.
function swarmVisual(
  populations: readonly { population: number }[],
  color: string,
  size: number,
  speed: number,
): PestSwarmVisual | null {
  const total = populations.reduce((sum, entry) => sum + entry.population, 0);
  if (total < MIN_VISIBLE_POPULATION) {
    return null;
  }
  return { count: clampCount(total * 8), size, speed, color };
}

// drei's Sparkles sizes points in view-space (gl_PointSize scales as
// 1/-viewPosition.z), so a size tuned for the garden-wide rain field
// (weather-visuals.ts tops out at 3 for snow) reads as sub-pixel once
// scaled down to a single bed's footprint — sized well above that range so
// the swarm is unmistakably visible, not a near-invisible speck.
export function pestSwarmVisual(pests: readonly PestSwarmVisualInput[]): PestSwarmVisual | null {
  return swarmVisual(pests, PEST_SWARM_COLOR, 2.2, 0.5);
}

// Slightly smaller and faster-moving than the pest swarm — predators
// hunting reads as more energetic motion than a pest infestation settling
// in, a cheap-but-legible differentiator alongside the color.
export function predatorSwarmVisual(predators: readonly PredatorSwarmVisualInput[]): PestSwarmVisual | null {
  return swarmVisual(predators, PREDATOR_SWARM_COLOR, 1.8, 0.9);
}
