class PestDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnknownPestKeyError extends PestDomainError {}
export class UnknownPredatorKeyError extends PestDomainError {}
export class InvalidPestActionAmountError extends PestDomainError {}
