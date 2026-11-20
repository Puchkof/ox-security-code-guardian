import { DomainError, ScanFailure } from '@code-guardian/core';
import { UnrecoverableError } from 'bullmq';

/**
 * Decides whether BullMQ may retry a failed attempt.
 * Domain errors (scan missing, invalid transition) and non-retryable scan failures
 * (repo not found, corrupt report, timeout) become UnrecoverableError so no attempts
 * are wasted. Retryable failures are rethrown as-is and BullMQ applies its backoff.
 */
export function toWorkerError(error: unknown): Error {
  if (error instanceof DomainError || (error instanceof ScanFailure && !error.retryable)) {
    const unrecoverable = new UnrecoverableError(`${error.code}: ${error.message}`);
    unrecoverable.cause = error;
    return unrecoverable;
  }
  if (error instanceof Error) return error;
  return new Error('Non-error value thrown while processing scan job', { cause: error });
}
