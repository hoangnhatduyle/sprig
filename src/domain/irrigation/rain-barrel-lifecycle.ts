// Mirrors SPEC-IRRIGATION-001 state_machines: "Rain barrel water level".
// A plain transition table (not xstate) — same rationale as
// src/domain/grid/planting-lifecycle.ts: a pure, synchronous FSM over a
// single persisted enum column.
//
// Note the forbidden EMPTY -> OVERFLOWING jump isn't expressed as a row to
// exclude: it simply has no entry below for ANY event, because the physical
// reality it encodes (a barrel must pass through PARTIAL and FULL before it
// can overflow) means no single legal hop can produce it. rain-barrel-service
// leans on that absence: filling from EMPTY is decomposed into the
// individually-legal hops below rather than jumping straight to a final
// status.

import { RainBarrelTransitionError } from "./errors";

export type RainBarrelStatus = "EMPTY" | "PARTIAL" | "FULL" | "OVERFLOWING";

export type RainBarrelTransitionEvent =
  | "add_water"
  | "reach_capacity"
  | "rain_stop"
  | "draw_water"
  | "reach_empty";

interface TransitionRule {
  from: RainBarrelStatus;
  event: RainBarrelTransitionEvent;
  to: RainBarrelStatus;
}

// draw_water needs the same self-loop-vs-threshold split add_water already
// has (add_water/reach_capacity): a draw that doesn't fully empty the barrel
// must stay PARTIAL via the same event name (draw_water) that also produced
// FULL -> PARTIAL, so it can't share an entry with the "drains to exactly
// zero" case — that case gets its own event, reach_empty, exactly mirroring
// why reach_capacity is distinct from add_water.
const TRANSITIONS: readonly TransitionRule[] = [
  { from: "EMPTY", event: "add_water", to: "PARTIAL" },
  { from: "PARTIAL", event: "add_water", to: "PARTIAL" },
  { from: "PARTIAL", event: "reach_capacity", to: "FULL" },
  { from: "FULL", event: "add_water", to: "OVERFLOWING" },
  { from: "OVERFLOWING", event: "rain_stop", to: "FULL" },
  { from: "FULL", event: "draw_water", to: "PARTIAL" },
  { from: "PARTIAL", event: "draw_water", to: "PARTIAL" },
  { from: "PARTIAL", event: "reach_empty", to: "EMPTY" },
  // OVERFLOWING and FULL both hold currentGallons === capacityGallons (the
  // excess above capacity is only ever journaled, never stored) — draining
  // from OVERFLOWING settles it to FULL first, mirroring how filling must
  // hop through reach_capacity before it can reach OVERFLOWING at all.
  { from: "OVERFLOWING", event: "draw_water", to: "FULL" },
];

export function isTransitionAllowed(
  from: RainBarrelStatus,
  event: RainBarrelTransitionEvent,
): boolean {
  return TRANSITIONS.some((rule) => rule.from === from && rule.event === event);
}

export function nextStatus(
  from: RainBarrelStatus,
  event: RainBarrelTransitionEvent,
): RainBarrelStatus {
  const rule = TRANSITIONS.find((r) => r.from === from && r.event === event);
  if (!rule) {
    throw new RainBarrelTransitionError(
      `Transition rejected: ${from} -[${event}]-> is not allowed`,
    );
  }
  return rule.to;
}
