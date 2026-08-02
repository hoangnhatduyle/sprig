class DiseaseDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnknownDiseaseKeyError extends DiseaseDomainError {}
