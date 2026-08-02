// Discriminable domain errors — lets callers branch on error type instead of
// regex-matching messages (mirrors src/domain/grid/errors.ts).

class IrrigationDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class RainBarrelTransitionError extends IrrigationDomainError {}
export class IrrigationCycleTransitionError extends IrrigationDomainError {}
export class InvalidWaterAmountError extends IrrigationDomainError {}
export class IrrigationSystemNotLinkedToAnyBedError extends IrrigationDomainError {}
export class ConcurrentModificationError extends IrrigationDomainError {}
export class InvalidDailyStartTimeError extends IrrigationDomainError {}
export class InvalidDurationMinutesError extends IrrigationDomainError {}
