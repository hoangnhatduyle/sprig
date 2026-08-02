// Discriminable domain errors — lets callers branch on error type instead of
// regex-matching messages (e.g. `catch (e) { if (e instanceof HarvestedCellError) ... }`).

class GridDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class HarvestedCellError extends GridDomainError {}
export class DuplicateCompanionPlantError extends GridDomainError {}
export class NoActivePlantingError extends GridDomainError {}
export class GeometryValidationError extends GridDomainError {}
export class JournalIntegrityViolationError extends GridDomainError {}
