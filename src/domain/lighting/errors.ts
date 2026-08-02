// Discriminable domain errors — mirrors src/domain/grid/errors.ts and
// src/domain/irrigation/errors.ts.

class LightingDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DayNightTransitionError extends LightingDomainError {}
export class SolarLightTransitionError extends LightingDomainError {}
export class InvalidChargeAmountError extends LightingDomainError {}
export class InvalidGardenLocationError extends LightingDomainError {}
export class SolarLightNotFoundError extends LightingDomainError {}
export class ConcurrentModificationError extends LightingDomainError {}
export class InvalidBaselineLightError extends LightingDomainError {}
