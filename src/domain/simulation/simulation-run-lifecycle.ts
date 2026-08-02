// Mirrors SPEC-VIEWER-001 state_machines: "Simulation run".
//
// DRAFT -[set_scenario]-> CONFIGURED -[start]-> RUNNING -[pause]-> PAUSED
// -[resume]-> RUNNING -[finish]-> COMPLETED.
//
// COMPLETED is terminal: no event leaves it. The spec's `forbidden` entry
// calls out COMPLETED -> RUNNING explicitly ("A completed simulation run
// must be re-configured as a new run, not resumed") — modeling COMPLETED as
// having no outgoing transitions at all is the same rule stated once, and
// also rules out the quieter variant of the same mistake (re-configuring a
// finished run in place, which would rewrite the record of what that run
// actually simulated).

import { SimulationRunTransitionError } from "./errors";

// Re-exported so a caller of the lifecycle table can catch the error that
// table throws without also reaching into ./errors.
export { SimulationRunTransitionError } from "./errors";

export type SimulationRunStatus = "DRAFT" | "CONFIGURED" | "RUNNING" | "PAUSED" | "COMPLETED";

export type SimulationRunEvent = "set_scenario" | "start" | "pause" | "resume" | "finish";

interface TransitionRule {
  from: SimulationRunStatus;
  event: SimulationRunEvent;
  to: SimulationRunStatus;
}

const TRANSITIONS: readonly TransitionRule[] = [
  { from: "DRAFT", event: "set_scenario", to: "CONFIGURED" },
  { from: "CONFIGURED", event: "start", to: "RUNNING" },
  { from: "RUNNING", event: "pause", to: "PAUSED" },
  { from: "PAUSED", event: "resume", to: "RUNNING" },
  { from: "RUNNING", event: "finish", to: "COMPLETED" },
];

export function isTransitionAllowed(
  from: SimulationRunStatus,
  event: SimulationRunEvent,
): boolean {
  return TRANSITIONS.some((rule) => rule.from === from && rule.event === event);
}

export function nextStatus(
  from: SimulationRunStatus,
  event: SimulationRunEvent,
): SimulationRunStatus {
  const rule = TRANSITIONS.find((r) => r.from === from && r.event === event);
  if (!rule) {
    throw new SimulationRunTransitionError(
      `Transition rejected: ${from} -[${event}]-> is not allowed`,
    );
  }
  return rule.to;
}
