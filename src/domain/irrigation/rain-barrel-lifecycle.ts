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
  | "draw_water";

interface TransitionRule {
  from: RainBarrelStatus;
  event: RainBarrelTransitionEvent;
  to: RainBarrelStatus;
}

const TRANSITIONS: readonly TransitionRule[] = [
  { from: "EMPTY", event: "add_water", to: "PARTIAL" },
  { from: "PARTIAL", event: "add_water", to: "PARTIAL" },
  { from: "PARTIAL", event: "reach_capacity", to: "FULL" },
  { from: "FULL", event: "add_water", to: "OVERFLOWING" },
  { from: "OVERFLOWING", event: "rain_stop", to: "FULL" },
  { from: "FULL", event: "draw_water", to: "PARTIAL" },
  { from: "PARTIAL", event: "draw_water", to: "EMPTY" },
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
