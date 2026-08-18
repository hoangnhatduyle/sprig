// Per-condition accent, reused by both forecast views (cards and chart).
// Reuses hues the app already assigns meaning to rather than inventing a
// new palette: clay (warm terracotta) reads as "sun" and already anchors
// CTAs/highlights here, the rain-barrel teal already means "water"
// (SPEC-IRRIGATION-001), and snow keeps the SIMULATION-adjacent plum it had
// before — every hue was already spoken for, so weather borrows meaning
// instead of adding a competing one.
export const CONDITION_ACCENT: Record<string, string> = {
  CLEAR: "var(--color-clay-strong)",
  PARTLY_CLOUDY: "var(--color-clay)",
  CLOUDY: "var(--color-text-muted)",
  RAIN: "var(--rainbarrel-fill)",
  STORM: "var(--rainbarrel-full-border)",
};
