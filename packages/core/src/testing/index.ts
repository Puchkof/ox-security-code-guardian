/**
 * In-memory port implementations for unit tests and for running delivery
 * adapters without infrastructure. Not meant for production use.
 */
import { type Scan, type Vulnerability } from '../domain';
import { Scan as ScanAggregate, TERMINAL_STATUSES } from '../domain';
import { ConcurrentScanUpdateError } from '../application/errors';
import {
  type Clock,
  type IdGenerator,
  type Logger,
  type Page,
  type PageRequest,
  type ScanJob,
  type ScanJobQueue,
  type ScanJobState,
  type ScanRepository,
  type VulnerabilityRepository,
} from '../application/ports';

export class InMemoryScanRepository implements ScanRepository {
  private readonly rows = new Map<string, ReturnType<Scan['toSnapshot']>>();

  /** Number of saves to reject with a generic error (simulates a database outage). */
  failNextSaves = 0;

  save(scan: Scan): Promise<void> {
    if (this.failNextSaves > 0) {
      this.failNextSaves -= 1;
      return Promise.reject(new Error('database unavailable'));
    }
    const stored = this.rows.get(scan.id);
    if ((stored?.version ?? 0) !== scan.version) {
      return Promise.reject(new ConcurrentScanUpdateError(scan.id));
    }
    const version = scan.version + 1;
    this.rows.set(scan.id, { ...scan.toSnapshot(), version });
    scan.markPersisted(version);
    return Promise.resolve();
  }

  findById(id: string): Promise<Scan | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? ScanAggregate.restore(row) : null);
  }

  findNonTerminalUpdatedBefore(before: Date, limit: number): Promise<Scan[]> {
    const rows = [...this.rows.values()]
      .filter((row) => !TERMINAL_STATUSES.has(row.status) && row.updatedAt < before)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit);
    return Promise.resolve(rows.map((row) => ScanAggregate.restore(row)));
  }
}

interface StoredFinding {
  readonly runId: string;
  readonly vulnerability: Vulnerability;
}

export class InMemoryVulnerabilityRepository implements VulnerabilityRepository {
  private readonly rows = new Map<string, StoredFinding[]>();

  appendBatch(
    scanId: string,
    runId: string,
    vulnerabilities: readonly Vulnerability[],
  ): Promise<void> {
    const existing = this.rows.get(scanId) ?? [];
    existing.push(...vulnerabilities.map((vulnerability) => ({ runId, vulnerability })));
    this.rows.set(scanId, existing);
    return Promise.resolve();
  }

  deleteByScan(scanId: string): Promise<void> {
    this.rows.delete(scanId);
    return Promise.resolve();
  }

  deleteOtherRuns(scanId: string, keepRunId: string): Promise<void> {
    const kept = (this.rows.get(scanId) ?? []).filter((row) => row.runId === keepRunId);
    this.rows.set(scanId, kept);
    return Promise.resolve();
  }

  findByScan(scanId: string, runId: string, page: PageRequest): Promise<Page<Vulnerability>> {
    const all = (this.rows.get(scanId) ?? [])
      .filter((row) => row.runId === runId)
      .map((row) => row.vulnerability);
    const offset = page.cursor === null ? 0 : Number.parseInt(page.cursor, 10);
    const items = all.slice(offset, offset + page.limit);
    const next = offset + items.length;
    return Promise.resolve({ items, nextCursor: next < all.length ? String(next) : null });
  }

  /** Rows of every run, for assertions. */
  countFor(scanId: string): number {
    return this.rows.get(scanId)?.length ?? 0;
  }
}

export class RecordingScanJobQueue implements ScanJobQueue {
  readonly jobs: ScanJob[] = [];
  failWith: Error | null = null;

  /** Job states reported to the reaper; unknown scans with a recorded job are `pending`. */
  readonly states = new Map<string, ScanJobState>();

  enqueue(job: ScanJob): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.jobs.push(job);
    return Promise.resolve();
  }

  getJobState(scanId: string): Promise<ScanJobState> {
    const explicit = this.states.get(scanId);
    if (explicit) return Promise.resolve(explicit);
    return Promise.resolve(this.jobs.some((job) => job.scanId === scanId) ? 'pending' : 'missing');
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date = new Date('2026-01-01T00:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = 'scan') {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}

export class SilentLogger implements Logger {
  info(): void {
    /* intentionally silent */
  }
  warn(): void {
    /* intentionally silent */
  }
  error(): void {
    /* intentionally silent */
  }
}
