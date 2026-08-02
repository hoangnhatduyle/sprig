class JournalDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class JournalValidationError extends JournalDomainError {}
