// Mirrors SPEC-IRRIGATION-001 state_machines: "Irrigation cycle".
// Two states only: the daily 08:00/10-minute automatic cycle is either
// IDLE or RUNNING. RUNNING -> RUNNING is forbidden (see isTransitionAllowed
// below) because re-triggering mid-run has no real-world equivalent — the
// physical valve is already open; a second "start" wouldn't water anything
// twice, it just isn't a meaningful event.

import { IrrigationCycleTransitionError } from "./errors";

export type IrrigationSystemStatus = "IDLE" | "RUNNING";

export type IrrigationCycleTransitionEvent = "schedule_time_reached" | "duration_elapsed";

interface TransitionRule {
  from: IrrigationSystemStatus;
  event: IrrigationCycleTransitionEvent;
  to: IrrigationSystemStatus;
}

const TRANSITIONS: readonly TransitionRule[] = [
  { from: "IDLE", event: "schedule_time_reached", to: "RUNNING" },
  { from: "RUNNING", event: "duration_elapsed", to: "IDLE" },
];

export function isTransitionAllowed(
  from: IrrigationSystemStatus,
  event: IrrigationCycleTransitionEvent,
): boolean {
  return TRANSITIONS.some((rule) => rule.from === from && rule.event === event);
}

export function nextStatus(
  from: IrrigationSystemStatus,
  event: IrrigationCycleTransitionEvent,
): IrrigationSystemStatus {
  const rule = TRANSITIONS.find((r) => r.from === from && r.event === event);
  if (!rule) {
    throw new IrrigationCycleTransitionError(
      `Transition rejected: ${from} -[${event}]-> is not allowed`,
    );
  }
  return rule.to;
}
