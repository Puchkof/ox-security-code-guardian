import { stat } from 'node:fs/promises';
import {
  InsufficientStorageError,
  ScanFailure,
  ScannerFailedError,
  ScanTimeoutError,
  type SecurityScanner,
} from '@code-guardian/core';
import {
  lastLines,
  ProcessSpawnError,
  runProcess,
  type ProcessResult,
} from '../process/run-process';

export interface TrivyCliScannerOptions {
  /** Path or name of the trivy binary. Defaults to `trivy` on PATH. */
  readonly trivyBinary?: string;
  /** Trivy cache directory (vulnerability DB). Shared across scans to avoid re-downloading it. */
  readonly cacheDir?: string;
  /** Trivy server URL; when set, the heavy DB lives in the server, not in the worker container. */
  readonly serverUrl?: string;
  /**
   * Trivy's own timeout (its default is 5m). Set it generously: the AbortSignal passed
   * to `scan()` is the real deadline, this only stops Trivy from giving up first.
   */
  readonly trivyTimeout?: string;
  /** Extra environment for trivy; merged over the parent's environment. */
  readonly env?: NodeJS.ProcessEnv;
  readonly stderrTailBytes?: number;
}

const DEFAULT_TRIVY_TIMEOUT = '60m';
const NO_SPACE = /no space left on device|ENOSPC/i;

/** The scanner binary is missing or cannot be executed: no retry will fix the deployment. */
export class ScannerUnavailableError extends ScanFailure {
  readonly code = 'SCANNER_UNAVAILABLE';
  readonly retryable = false;
}

/**
 * Runs `trivy fs` and lets it write the JSON report straight to disk (`--output`),
 * so the (possibly 500MB+) report never passes through this process's memory.
 * stdout is ignored and stderr is kept as a bounded tail for diagnostics.
 */
export class TrivyCliScanner implements SecurityScanner {
  private readonly trivyBinary: string;

  constructor(private readonly options: TrivyCliScannerOptions = {}) {
    this.trivyBinary = options.trivyBinary ?? 'trivy';
  }

  /** Exposed for tests and diagnostics. */
  buildArgs(sourceDir: string, reportFile: string): string[] {
    const { cacheDir, serverUrl } = this.options;
    return [
      'fs',
      '--scanners',
      'vuln',
      '--format',
      'json',
      '--output',
      reportFile,
      '--quiet',
      '--timeout',
      this.options.trivyTimeout ?? DEFAULT_TRIVY_TIMEOUT,
      ...(cacheDir ? ['--cache-dir', cacheDir] : []),
      ...(serverUrl ? ['--server', serverUrl] : []),
      '--',
      sourceDir,
    ];
  }

  async scan(sourceDir: string, reportFile: string, signal: AbortSignal): Promise<void> {
    let result: ProcessResult;
    try {
      result = await runProcess({
        command: this.trivyBinary,
        args: this.buildArgs(sourceDir, reportFile),
        signal,
        env: { ...process.env, ...this.options.env, TRIVY_NO_PROGRESS: 'true' },
        ...(this.options.stderrTailBytes === undefined
          ? {}
          : { stderrTailBytes: this.options.stderrTailBytes }),
      });
    } catch (error: unknown) {
      throw this.mapSpawnError(error);
    }

    if (result.aborted) {
      throw new ScanTimeoutError('scan', { cause: signal.reason });
    }
    if (result.exitCode !== 0) {
      throw mapScannerFailure(result);
    }
    await assertReportWritten(reportFile, result);
  }

  private mapSpawnError(error: unknown): Error {
    if (!(error instanceof ProcessSpawnError)) {
      return error instanceof Error ? error : new Error(String(error));
    }
    if (error.errno === 'ENOSPC') {
      return new InsufficientStorageError('No space left on device', { cause: error });
    }
    if (error.errno === 'ENOENT') {
      return new ScannerUnavailableError(
        `Trivy is not installed (binary "${this.trivyBinary}" not found)`,
        { cause: error },
      );
    }
    return new ScannerUnavailableError(`Failed to start Trivy: ${error.message}`, { cause: error });
  }
}

/** Exported for unit tests. */
export function mapScannerFailure(result: ProcessResult): Error {
  if (NO_SPACE.test(result.stderrTail)) {
    return new InsufficientStorageError('No space left on device while running Trivy');
  }
  const exit =
    result.exitCode === null
      ? `was killed by ${result.exitSignal ?? 'a signal'}`
      : `exited with code ${result.exitCode}`;
  const detail = lastLines(result.stderrTail);
  return new ScannerFailedError(
    `Trivy ${exit}${detail ? `: ${detail}` : ''}`,
    result.exitCode,
    result.stderrTail,
  );
}

async function assertReportWritten(reportFile: string, result: ProcessResult): Promise<void> {
  try {
    const info = await stat(reportFile);
    if (info.isFile()) return;
  } catch {
    // Fall through: treated as a missing report.
  }
  throw new ScannerFailedError(
    'Trivy exited successfully but did not write a report',
    result.exitCode,
    result.stderrTail,
  );
}
