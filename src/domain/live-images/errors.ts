class LiveImageDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class LiveImageValidationError extends LiveImageDomainError {}
