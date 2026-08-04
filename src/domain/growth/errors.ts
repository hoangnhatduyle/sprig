// Discriminable domain errors for the growth engine — mirrors
// src/domain/grid/errors.ts's pattern (subclass per failure, not string
// matching).

class GrowthDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidClockRateError extends GrowthDomainError {}

export class SpeciesValidationError extends GrowthDomainError {}
