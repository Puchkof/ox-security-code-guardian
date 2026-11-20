import { mkdir, mkdtemp, readdir, rm, stat, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  InsufficientStorageError,
  type ScanWorkspace,
  type WorkspaceProvider,
} from '@code-guardian/core';

export interface TmpWorkspaceProviderOptions {
  /** Directory under which per-scan workspaces are created. Defaults to `<os tmp>/code-guardian`. */
  readonly baseDir?: string;
  /**
   * Minimum free bytes on the base directory's filesystem before a scan may start.
   * Clone + a 500MB+ report need headroom, so refusing early beats failing half-way.
   */
  readonly minFreeBytes: number;
}

/** Every workspace directory starts with this, so the orphan sweep never touches foreign files. */
export const WORKSPACE_PREFIX = 'scan-';
const SOURCE_DIR = 'src';
const REPORT_FILE = 'trivy-report.json';

function hasErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Keeps the scan id usable as part of a directory name whatever it contains. */
function safeSegment(scanId: string): string {
  return scanId.replace(/[^A-Za-z0-9-]/g, '_').slice(0, 64);
}

class TmpScanWorkspace implements ScanWorkspace {
  readonly sourceDir: string;
  readonly reportFile: string;

  constructor(readonly root: string) {
    // sourceDir is intentionally not created: `git clone` wants a missing or empty target.
    this.sourceDir = path.join(root, SOURCE_DIR);
    this.reportFile = path.join(root, REPORT_FILE);
  }

  async dispose(): Promise<void> {
    await rm(this.root, { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * Creates one private temp directory per scan run and removes it afterwards.
 * `sweepOrphans` cleans directories left behind by a crashed or killed worker.
 */
export class TmpWorkspaceProvider implements WorkspaceProvider {
  readonly baseDir: string;
  private readonly minFreeBytes: number;

  constructor(options: TmpWorkspaceProviderOptions) {
    this.baseDir = path.resolve(options.baseDir ?? path.join(tmpdir(), 'code-guardian'));
    this.minFreeBytes = options.minFreeBytes;
  }

  async create(scanId: string): Promise<ScanWorkspace> {
    try {
      await mkdir(this.baseDir, { recursive: true });
      await this.assertFreeSpace();
      const root = await mkdtemp(
        path.join(this.baseDir, `${WORKSPACE_PREFIX}${safeSegment(scanId)}-`),
      );
      return new TmpScanWorkspace(root);
    } catch (error: unknown) {
      if (hasErrnoCode(error, 'ENOSPC')) {
        throw new InsufficientStorageError('No space left on device for a scan workspace', {
          cause: error,
        });
      }
      throw error;
    }
  }

  /** Free bytes available to this (unprivileged) process on the base directory's filesystem. */
  async freeBytes(): Promise<number> {
    const fsStats = await statfs(this.baseDir);
    return fsStats.bavail * fsStats.bsize;
  }

  /**
   * Removes workspace directories older than `olderThanMs` (by mtime). Call it on worker
   * startup, before jobs are taken, so it never races a scan of this worker.
   * @returns the number of directories removed.
   */
  async sweepOrphans(olderThanMs: number, now: Date = new Date()): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(this.baseDir);
    } catch (error: unknown) {
      if (hasErrnoCode(error, 'ENOENT')) return 0;
      throw error;
    }

    const cutoff = now.getTime() - olderThanMs;
    let removed = 0;
    for (const name of entries) {
      if (!name.startsWith(WORKSPACE_PREFIX)) continue;
      const fullPath = path.join(this.baseDir, name);
      try {
        const info = await stat(fullPath);
        if (!info.isDirectory() || info.mtimeMs > cutoff) continue;
        await rm(fullPath, { recursive: true, force: true, maxRetries: 3 });
        removed += 1;
      } catch (error: unknown) {
        // Removed concurrently: nothing left to do.
        if (!hasErrnoCode(error, 'ENOENT')) throw error;
      }
    }
    return removed;
  }

  private async assertFreeSpace(): Promise<void> {
    const free = await this.freeBytes();
    if (free < this.minFreeBytes) {
      throw new InsufficientStorageError(
        `Not enough free disk space for a scan: ${formatMb(free)} available, ${formatMb(this.minFreeBytes)} required`,
      );
    }
  }
}

function formatMb(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))}MB`;
}
