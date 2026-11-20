import { spawn } from 'node:child_process';

/** Default size of the stderr tail kept for diagnostics. */
export const DEFAULT_STDERR_TAIL_BYTES = 8 * 1024;
/** How long a child gets to exit after SIGTERM before it is SIGKILLed. */
const DEFAULT_KILL_GRACE_MS = 5_000;

export interface RunProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly signal: AbortSignal;
  readonly cwd?: string;
  /** Full environment of the child. Defaults to the parent's environment. */
  readonly env?: NodeJS.ProcessEnv;
  /** Upper bound on the stderr kept in memory (only the last bytes are kept). */
  readonly stderrTailBytes?: number;
  readonly killGraceMs?: number;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly exitSignal: NodeJS.Signals | null;
  /** Last `stderrTailBytes` of stderr, decoded as UTF-8. */
  readonly stderrTail: string;
  /** True when the child was stopped because `signal` aborted. */
  readonly aborted: boolean;
}

/** The binary could not be started at all (ENOENT, EACCES, ENOSPC, ...). */
export class ProcessSpawnError extends Error {
  constructor(
    readonly command: string,
    readonly errno: string | undefined,
    options?: { cause?: unknown },
  ) {
    super(`Failed to start "${command}"${errno ? ` (${errno})` : ''}`, options);
    this.name = 'ProcessSpawnError';
  }
}

/**
 * Keeps only the last `capacity` bytes written to it, so a chatty child cannot
 * grow the heap: memory is bounded by `capacity` plus one incoming chunk.
 */
export class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly capacity: number) {}

  push(chunk: Buffer): void {
    if (this.capacity <= 0) return;
    if (chunk.length >= this.capacity) {
      this.chunks = [chunk.subarray(chunk.length - this.capacity)];
      this.size = this.capacity;
      return;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.capacity) {
      const head = this.chunks[0];
      if (head === undefined) break;
      const excess = this.size - this.capacity;
      if (head.length <= excess) {
        this.chunks.shift();
        this.size -= head.length;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.size -= excess;
      }
    }
  }

  toString(): string {
    return Buffer.concat(this.chunks, this.size).toString('utf8');
  }
}

function errnoOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * Runs a binary without a shell, captures a bounded stderr tail and honours an AbortSignal.
 *
 * Resolves with the exit status whatever it is; the caller maps it to a domain failure.
 * Rejects only with ProcessSpawnError when the binary cannot be started.
 *
 * The child runs in its own process group so that an abort also stops its helpers
 * (e.g. `git-remote-https`), not just the direct child.
 */
export function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  const { command, args, signal } = options;
  const stderr = new TailBuffer(options.stderrTailBytes ?? DEFAULT_STDERR_TAIL_BYTES);

  if (signal.aborted) {
    return Promise.resolve({ exitCode: null, exitSignal: null, stderrTail: '', aborted: true });
  }

  return new Promise<ProcessResult>((resolve, reject) => {
    let aborted = false;
    let killTimer: NodeJS.Timeout | undefined;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });

    const killGroup = (killSignal: NodeJS.Signals): void => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        if (process.platform === 'win32') child.kill(killSignal);
        else process.kill(-pid, killSignal);
      } catch {
        // Already gone.
      }
    };

    const onAbort = (): void => {
      aborted = true;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => {
        killGroup('SIGKILL');
      }, options.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
      killTimer.unref();
    };

    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });

    child.once('error', (error: Error) => {
      cleanup();
      reject(new ProcessSpawnError(command, errnoOf(error), { cause: error }));
    });

    child.once('close', (exitCode: number | null, exitSignal: NodeJS.Signals | null) => {
      cleanup();
      resolve({ exitCode, exitSignal, stderrTail: stderr.toString(), aborted });
    });
  });
}

/** Last non-empty lines of a stderr tail, for short, readable failure messages. */
export function lastLines(text: string, count = 3): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-count)
    .join(' | ');
}
