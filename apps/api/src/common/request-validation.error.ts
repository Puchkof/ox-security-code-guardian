/** Raised by ZodValidationPipe when a request does not match its schema. */
export class RequestValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';

  constructor(readonly issues: readonly string[]) {
    super(`Invalid request: ${issues.join('; ')}`);
    this.name = 'RequestValidationError';
  }
}
