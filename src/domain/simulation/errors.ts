// Discriminable domain errors — lets callers branch on error type instead of
// regex-matching messages (mirrors src/domain/grid/errors.ts and
// src/domain/irrigation/errors.ts).

class SimulationDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

// Rejected SimulationRun state-machine hop (SPEC-VIEWER-001 "Simulation run").
// Re-exported from ./simulation-run-lifecycle so callers of the pure
// lifecycle table can import the error it throws from the same module.
export class SimulationRunTransitionError extends SimulationDomainError {}

// A scenario referencing a GridCell that does not exist. Persisting it would
// leave a dangling reference inside SimulationRun.waterInput/affectedCells
// that no later read could resolve — so it fails loudly at configure time.
export class UnknownSimulationCellError extends SimulationDomainError {}

// A water amount that isn't a positive, finite number of gallons. A zero or
// negative "watering" is a misconfiguration, not a meaningful scenario.
export class InvalidSimulationWaterAmountError extends SimulationDomainError {}
