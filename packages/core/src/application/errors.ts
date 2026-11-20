/**
 * Failures of the scan pipeline. `retryable` tells the job runner whether another
 * attempt could succeed (network flake, disk temporarily full) or is pointless
 * (repository does not exist, corrupt report).
 */
export abstract class ScanFailure extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class CloneFailedError extends ScanFailure {
  readonly code = 'CLONE_FAILED';

  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class ScannerFailedError extends ScanFailure {
  readonly code = 'SCANNER_FAILED';
  readonly retryable = true;

  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class ReportParseFailedError extends ScanFailure {
  readonly code = 'REPORT_PARSE_FAILED';
  readonly retryable = false;
}

export class InsufficientStorageError extends ScanFailure {
  readonly code = 'INSUFFICIENT_STORAGE';
  readonly retryable = true;
}

export class ScanTimeoutError extends ScanFailure {
  readonly code = 'SCAN_TIMEOUT';
  readonly retryable = false;

  constructor(
    readonly stage: 'clone' | 'scan' | 'parse',
    options?: { cause?: unknown },
  ) {
    super(`Scan timed out during ${stage}`, options);
  }
}

export class UnexpectedScanError extends ScanFailure {
  readonly code = 'UNEXPECTED';
  readonly retryable = true;

  constructor(options?: { cause?: unknown }) {
    super('Unexpected error while scanning', options);
  }
}

/** Raised by StartScan when the scan was stored but could not be handed to the queue. */
export class QueueUnavailableError extends Error {
  readonly code = 'QUEUE_UNAVAILABLE';

  constructor(options?: { cause?: unknown }) {
    super('Scan queue is unavailable, please retry later', options);
    this.name = 'QueueUnavailableError';
  }
}

function hasErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Normalises anything thrown in the pipeline into a ScanFailure. */
export function toScanFailure(error: unknown): ScanFailure {
  if (error instanceof ScanFailure) return error;
  if (hasErrnoCode(error, 'ENOSPC')) {
    return new InsufficientStorageError('No space left on device', { cause: error });
  }
  return new UnexpectedScanError({ cause: error });
}
