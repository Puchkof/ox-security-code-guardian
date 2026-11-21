import {
  CloneFailedError,
  InsufficientStorageError,
  ScanTimeoutError,
  type RepoUrl,
  type RepositoryCloner,
} from '@code-guardian/core';
import {
  lastLines,
  ProcessSpawnError,
  runProcess,
  type ProcessResult,
} from '../process/run-process';

export interface GitCliClonerOptions {
  /** Path or name of the git binary. Defaults to `git` on PATH. */
  readonly gitBinary?: string;
  /** Extra environment for git; merged over the parent's environment. */
  readonly env?: NodeJS.ProcessEnv;
  readonly stderrTailBytes?: number;
}

const NO_SPACE = /no space left on device|ENOSPC/i;
/** The repository does not exist, is private, or needs credentials: retrying cannot help. */
const PERMANENT = [
  /repository ['"]?.*['"]? not found/i,
  /repository not found/i,
  /could not read username/i,
  /terminal prompts disabled/i,
  /authentication failed/i,
  /HTTP Basic: Access denied/i,
  /The requested URL returned error: (401|403|404)/i,
];
/** Transport problems that may well go away on the next attempt. */
const TRANSIENT = [
  /could not resolve host/i,
  /failed to connect/i,
  /connection (timed out|refused|reset)/i,
  /operation timed out/i,
  /early EOF/i,
  /RPC failed/i,
  /remote end hung up/i,
  /unable to access/i,
  /The requested URL returned error: (429|5\d\d)/i,
  /TLS|SSL/,
];

/**
 * Shallow-clones a repository with the git CLI.
 *
 * Only the canonical `RepoUrl.cloneUrl` is passed, after `--`, and no shell is involved,
 * so the URL cannot be turned into extra git options. Credential prompts are disabled,
 * otherwise a private repo would hang the worker until the timeout.
 */
export class GitCliCloner implements RepositoryCloner {
  private readonly gitBinary: string;

  constructor(private readonly options: GitCliClonerOptions = {}) {
    this.gitBinary = options.gitBinary ?? 'git';
  }

  async clone(repoUrl: RepoUrl, destination: string, signal: AbortSignal): Promise<void> {
    let result: ProcessResult;
    try {
      result = await runProcess({
        command: this.gitBinary,
        args: [
          'clone',
          '--depth',
          '1',
          '--single-branch',
          '--no-tags',
          '--',
          repoUrl.cloneUrl,
          destination,
        ],
        signal,
        env: {
          ...process.env,
          ...this.options.env,
          GIT_TERMINAL_PROMPT: '0',
          // Never fall back to an interactive askpass helper or the system credential store prompt.
          GIT_ASKPASS: 'echo',
          SSH_ASKPASS: 'echo',
          GCM_INTERACTIVE: 'never',
        },
        ...(this.options.stderrTailBytes === undefined
          ? {}
          : { stderrTailBytes: this.options.stderrTailBytes }),
      });
    } catch (error: unknown) {
      throw mapSpawnError(this.gitBinary, error);
    }

    if (result.aborted) {
      throw new ScanTimeoutError('clone', { cause: signal.reason });
    }
    if (result.exitCode === 0) return;
    throw mapCloneFailure(repoUrl, result);
  }
}

function mapSpawnError(binary: string, error: unknown): Error {
  if (!(error instanceof ProcessSpawnError))
    return error instanceof Error ? error : new Error(String(error));
  if (error.errno === 'ENOSPC') {
    return new InsufficientStorageError('No space left on device', { cause: error });
  }
  if (error.errno === 'ENOENT') {
    return new CloneFailedError(`git is not installed (binary "${binary}" not found)`, false, {
      cause: error,
    });
  }
  return new CloneFailedError(`Failed to start git: ${error.message}`, false, { cause: error });
}

/** Exported for unit tests. */
export function mapCloneFailure(repoUrl: RepoUrl, result: ProcessResult): Error {
  const stderr = result.stderrTail;
  const detail = lastLines(stderr);
  const exit =
    result.exitCode === null
      ? `signal ${result.exitSignal ?? 'unknown'}`
      : `exit code ${result.exitCode}`;

  if (NO_SPACE.test(stderr)) {
    return new InsufficientStorageError(`No space left on device while cloning ${repoUrl.value}`);
  }
  if (PERMANENT.some((pattern) => pattern.test(stderr))) {
    return new CloneFailedError(
      `Repository ${repoUrl.value} was not found or is not public`,
      false,
    );
  }
  if (TRANSIENT.some((pattern) => pattern.test(stderr))) {
    return new CloneFailedError(`Network error while cloning ${repoUrl.value}: ${detail}`, true);
  }
  // Unknown git failure: retry, the job's bounded attempts stop it from looping forever.
  return new CloneFailedError(`git clone failed with ${exit}${detail ? `: ${detail}` : ''}`, true);
}
