/**
 * Failures of the scan pipeline. `retryable` tells the job runner whether another
 * attempt could succeed (network flake, disk temporarily full) or is pointless
 * (repository does not exist, corrupt report).
 */
export abstract class ScanFailure extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  /**
   * Client-safe description stored as the scan's failureReason. `message` may contain
   * scanner/git stderr, file paths or internal hostnames and goes to logs only.
   */
  abstract readonly publicMessage: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class CloneFailedError extends ScanFailure {
  readonly code = 'CLONE_FAILED';

  get publicMessage(): string {
    return this.retryable
      ? 'Could not clone the repository (network or Git error)'
      : 'Repository was not found or is not public';
  }

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
  readonly publicMessage = 'The security scanner failed';

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
  readonly publicMessage = 'The scanner report could not be parsed';
}

export class InsufficientStorageError extends ScanFailure {
  readonly code = 'INSUFFICIENT_STORAGE';
  readonly retryable = true;
  readonly publicMessage = 'Not enough disk space to run the scan';
}

export class ScanTimeoutError extends ScanFailure {
  readonly code = 'SCAN_TIMEOUT';
  readonly retryable = false;

  get publicMessage(): string {
    return `Scan timed out during ${this.stage}`;
  }

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
  readonly publicMessage = 'Unexpected error while scanning';

  constructor(options?: { cause?: unknown }) {
    super('Unexpected error while scanning', options);
  }
}

/**
 * Another writer changed the scan since it was loaded (optimistic-concurrency conflict).
 * Raised by ScanRepository.save.
 */
export class ConcurrentScanUpdateError extends Error {
  readonly code = 'CONCURRENT_SCAN_UPDATE';

  constructor(readonly scanId: string) {
    super(`Scan ${scanId} was modified concurrently`);
    this.name = 'ConcurrentScanUpdateError';
  }
}

/**
 * This attempt lost ownership of the scan to a newer attempt (e.g. a stalled job was
 * redelivered while the original worker was still alive). The attempt stops without
 * touching the scan; the owner decides the outcome.
 */
export class ScanOwnershipLostError extends ScanFailure {
  readonly code = 'SCAN_OWNERSHIP_LOST';
  readonly retryable = false;
  readonly publicMessage = 'Scan was taken over by another attempt';

  constructor(scanId: string, options?: { cause?: unknown }) {
    super(`Scan ${scanId} is now owned by another attempt`, options);
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
