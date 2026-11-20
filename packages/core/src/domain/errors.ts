/**
 * Errors raised when a business rule is violated. Delivery adapters map them to
 * client errors (4xx); they are never retryable.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidRepoUrlError extends DomainError {
  readonly code = 'INVALID_REPO_URL';

  constructor(readonly input: string) {
    super('Repository URL must look like https://github.com/<owner>/<repo>');
  }
}

export class ScanNotFoundError extends DomainError {
  readonly code = 'SCAN_NOT_FOUND';

  constructor(readonly scanId: string) {
    super(`Scan ${scanId} was not found`);
  }
}

export class InvalidScanTransitionError extends DomainError {
  readonly code = 'INVALID_SCAN_TRANSITION';

  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Scan cannot move from ${from} to ${to}`);
  }
}
