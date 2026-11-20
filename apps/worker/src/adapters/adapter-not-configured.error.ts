import { ScanFailure } from '@code-guardian/core';

/** Thrown by placeholder adapters. Not retryable: another attempt cannot succeed. */
export class AdapterNotConfiguredError extends ScanFailure {
  readonly code = 'ADAPTER_NOT_CONFIGURED';
  readonly retryable = false;

  constructor(port: string) {
    super(`${port} adapter is not configured in this build`);
  }
}
