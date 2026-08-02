// Mirrors SPEC-GRID-001 state_machines: "Grid cell planting lifecycle".
// A plain transition table (not xstate) — this is a pure, synchronous FSM
// over a single persisted enum column, with no need for xstate's actor
// model, context, or effects.

export type CellStatus =
  | "EMPTY"
  | "PLANTED"
  | "GERMINATED"
  | "GROWING"
  | "HARVESTED"
  | "REMOVED";

export type PlantingEvent =
  | "assign_plant"
  | "germinate"
  | "grow"
  | "harvest"
  | "clear"
  | "remove";

interface TransitionRule {
  from: CellStatus;
  event: PlantingEvent;
  to: CellStatus;
}

const TRANSITIONS: readonly TransitionRule[] = [
  { from: "EMPTY", event: "assign_plant", to: "PLANTED" },
  { from: "PLANTED", event: "germinate", to: "GERMINATED" },
  { from: "GERMINATED", event: "grow", to: "GROWING" },
  { from: "GROWING", event: "harvest", to: "HARVESTED" },
  { from: "HARVESTED", event: "clear", to: "REMOVED" },
  { from: "PLANTED", event: "remove", to: "REMOVED" },
  { from: "GERMINATED", event: "remove", to: "REMOVED" },
  { from: "GROWING", event: "remove", to: "REMOVED" },
  { from: "REMOVED", event: "assign_plant", to: "PLANTED" },
];

export class LifecycleTransitionError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export function isTransitionAllowed(from: CellStatus, event: PlantingEvent): boolean {
  return TRANSITIONS.some((rule) => rule.from === from && rule.event === event);
}

export function nextStatus(from: CellStatus, event: PlantingEvent): CellStatus {
  const rule = TRANSITIONS.find((r) => r.from === from && r.event === event);
  if (!rule) {
    throw new LifecycleTransitionError(`Transition rejected: ${from} -[${event}]-> is not allowed`);
  }
  return rule.to;
}
