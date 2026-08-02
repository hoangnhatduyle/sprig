// Mirrors SPEC-LIGHT-001 state_machines: "Day/night cycle". A plain
// transition table (not xstate) — same rationale as
// src/domain/irrigation/rain-barrel-lifecycle.ts: a pure, synchronous FSM,
// here over the ephemeral (never persisted — see the schema.prisma note on
// DayNightCycle) simulated phase.
//
// The forbidden DAY -> NIGHT and NIGHT -> DAY jumps aren't rows to exclude:
// they simply have no entry below for any event, because the table only
// ever advances one phase at a time (DAWN -> DAY -> DUSK -> NIGHT -> DAWN).
// sun-times.ts's computePhase leans on that absence: it derives the phase
// directly from location-computed sun times rather than by firing these
// events, so it can never land on a phase this table wouldn't reach by a
// legal hop.

import { DayNightTransitionError } from "./errors";

export type DayNightPhase = "DAWN" | "DAY" | "DUSK" | "NIGHT";

export type DayNightTransitionEvent =
  | "sunrise_complete"
  | "sunset_begins"
  | "dark_falls"
  | "sunrise_begins";

interface TransitionRule {
  from: DayNightPhase;
  event: DayNightTransitionEvent;
  to: DayNightPhase;
}

const TRANSITIONS: readonly TransitionRule[] = [
  { from: "DAWN", event: "sunrise_complete", to: "DAY" },
  { from: "DAY", event: "sunset_begins", to: "DUSK" },
  { from: "DUSK", event: "dark_falls", to: "NIGHT" },
  { from: "NIGHT", event: "sunrise_begins", to: "DAWN" },
];

export function isTransitionAllowed(
  from: DayNightPhase,
  event: DayNightTransitionEvent,
): boolean {
  return TRANSITIONS.some((rule) => rule.from === from && rule.event === event);
}

export function nextPhase(
  from: DayNightPhase,
  event: DayNightTransitionEvent,
): DayNightPhase {
  const rule = TRANSITIONS.find((r) => r.from === from && r.event === event);
  if (!rule) {
    throw new DayNightTransitionError(
      `Transition rejected: ${from} -[${event}]-> is not allowed`,
    );
  }
  return rule.to;
}
