import { InvalidRepoUrlError, QueueUnavailableError, ScanNotFoundError } from '@code-guardian/core';
import { InvalidCursorError } from '@code-guardian/infrastructure';
import { HttpException, HttpStatus } from '@nestjs/common';
import { RequestValidationError } from './request-validation.error';

export interface ErrorDescriptor {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/** Body of every error response of the REST API. */
export interface ErrorResponseBody {
  readonly error: { readonly code: string; readonly message: string };
}

const INTERNAL: ErrorDescriptor = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: 'INTERNAL_ERROR',
  message: 'Internal server error',
};

/**
 * Single source of truth for turning an exception into a client-facing error, shared by
 * the REST and GraphQL transports. Anything not recognised becomes a 500 with a generic
 * message, so internals (stack traces, SQL, file paths) never leak.
 */
export function describeError(error: unknown): ErrorDescriptor {
  if (
    error instanceof RequestValidationError ||
    error instanceof InvalidRepoUrlError ||
    error instanceof InvalidCursorError
  ) {
    return { status: HttpStatus.BAD_REQUEST, code: error.code, message: error.message };
  }
  if (error instanceof ScanNotFoundError) {
    return { status: HttpStatus.NOT_FOUND, code: error.code, message: error.message };
  }
  if (error instanceof QueueUnavailableError) {
    return { status: HttpStatus.SERVICE_UNAVAILABLE, code: error.code, message: error.message };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status >= 500) return { ...INTERNAL, status };
    const name: unknown = HttpStatus[status];
    return {
      status,
      code: typeof name === 'string' ? name : 'HTTP_ERROR',
      message: error.message,
    };
  }
  return INTERNAL;
}
