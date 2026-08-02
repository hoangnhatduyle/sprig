// Mirrors SPEC-LIGHT-001 state_machines: "Solar light lifecycle". Same
// pure-transition-table approach as day-night-lifecycle.ts and
// src/domain/irrigation/rain-barrel-lifecycle.ts.
//
// The forbidden DEPLETED -> ILLUMINATED and CHARGING -> ILLUMINATED jumps
// aren't rows to exclude: dusk_falls only has an entry from READY, so
// solar-light-service leans on that absence the same way rain-barrel-service
// leans on the missing EMPTY -> OVERFLOWING row — there is no single legal
// hop that turns a light on before it has reached READY (sufficient charge).

import { SolarLightTransitionError } from "./errors";

export type SolarLightStatus = "CHARGING" | "READY" | "ILLUMINATED" | "DEPLETED";

export type SolarLightTransitionEvent =
  | "charge_sufficient"
  | "dusk_falls"
  | "dawn_breaks"
  | "charge_depleted";

interface TransitionRule {
  from: SolarLightStatus;
  event: SolarLightTransitionEvent;
  to: SolarLightStatus;
}

const TRANSITIONS: readonly TransitionRule[] = [
  { from: "CHARGING", event: "charge_sufficient", to: "READY" },
  { from: "READY", event: "dusk_falls", to: "ILLUMINATED" },
  { from: "ILLUMINATED", event: "dawn_breaks", to: "CHARGING" },
  { from: "ILLUMINATED", event: "charge_depleted", to: "DEPLETED" },
  { from: "DEPLETED", event: "dawn_breaks", to: "CHARGING" },
];

export function isTransitionAllowed(
  from: SolarLightStatus,
  event: SolarLightTransitionEvent,
): boolean {
  return TRANSITIONS.some((rule) => rule.from === from && rule.event === event);
}

export function nextStatus(
  from: SolarLightStatus,
  event: SolarLightTransitionEvent,
): SolarLightStatus {
  const rule = TRANSITIONS.find((r) => r.from === from && r.event === event);
  if (!rule) {
    throw new SolarLightTransitionError(
      `Transition rejected: ${from} -[${event}]-> is not allowed`,
    );
  }
  return rule.to;
}
