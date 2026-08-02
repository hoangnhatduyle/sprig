class ConditionsDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConditionIntensityError extends ConditionsDomainError {}
export class InvalidProjectionInputError extends ConditionsDomainError {}
