class SoilDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidSoilTextureError extends SoilDomainError {}
export class InvalidCareActionAmountError extends SoilDomainError {}
