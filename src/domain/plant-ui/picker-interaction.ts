// Mirrors SPEC-PLANTUI-001 state_machines: "Cell picker interaction".
// A plain transition table (not xstate) — matches the project convention
// established by GRID/LIGHT/IRRIGATION lifecycle modules: this is a pure,
// synchronous FSM over ephemeral UI state, with no need for xstate's actor
// model, context, or effects.

export type PickerState = "IDLE" | "CELL_SELECTED" | "PICKER_OPEN";

export type PickerEvent = "click_cell" | "open_picker" | "select_plant" | "cancel" | "deselect";

interface TransitionRule {
  from: PickerState;
  event: PickerEvent;
  to: PickerState;
}

const TRANSITIONS: readonly TransitionRule[] = [
  { from: "IDLE", event: "click_cell", to: "CELL_SELECTED" },
  { from: "CELL_SELECTED", event: "open_picker", to: "PICKER_OPEN" },
  { from: "PICKER_OPEN", event: "select_plant", to: "IDLE" },
  { from: "PICKER_OPEN", event: "cancel", to: "IDLE" },
  { from: "CELL_SELECTED", event: "deselect", to: "IDLE" },
];

export class PickerTransitionError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export function isTransitionAllowed(from: PickerState, event: PickerEvent): boolean {
  return TRANSITIONS.some((rule) => rule.from === from && rule.event === event);
}

export function nextPickerState(from: PickerState, event: PickerEvent): PickerState {
  const rule = TRANSITIONS.find((r) => r.from === from && r.event === event);
  if (!rule) {
    throw new PickerTransitionError(`Transition rejected: ${from} -[${event}]-> is not allowed`);
  }
  return rule.to;
}
