/**
 * In-memory port implementations for unit tests and for running delivery
 * adapters without infrastructure. Not meant for production use.
 */
import { type Scan, type Vulnerability } from '../domain';
import { Scan as ScanAggregate } from '../domain';
import {
  type Clock,
  type IdGenerator,
  type Logger,
  type Page,
  type PageRequest,
  type ScanJob,
  type ScanJobQueue,
  type ScanRepository,
  type VulnerabilityRepository,
} from '../application/ports';

export class InMemoryScanRepository implements ScanRepository {
  private readonly rows = new Map<string, ReturnType<Scan['toSnapshot']>>();

  save(scan: Scan): Promise<void> {
    this.rows.set(scan.id, scan.toSnapshot());
    return Promise.resolve();
  }

  findById(id: string): Promise<Scan | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? ScanAggregate.restore(row) : null);
  }
}

export class InMemoryVulnerabilityRepository implements VulnerabilityRepository {
  private readonly rows = new Map<string, Vulnerability[]>();

  appendBatch(scanId: string, vulnerabilities: readonly Vulnerability[]): Promise<void> {
    const existing = this.rows.get(scanId) ?? [];
    existing.push(...vulnerabilities);
    this.rows.set(scanId, existing);
    return Promise.resolve();
  }

  deleteByScan(scanId: string): Promise<void> {
    this.rows.delete(scanId);
    return Promise.resolve();
  }

  findByScan(scanId: string, page: PageRequest): Promise<Page<Vulnerability>> {
    const all = this.rows.get(scanId) ?? [];
    const offset = page.cursor === null ? 0 : Number.parseInt(page.cursor, 10);
    const items = all.slice(offset, offset + page.limit);
    const next = offset + items.length;
    return Promise.resolve({ items, nextCursor: next < all.length ? String(next) : null });
  }

  countFor(scanId: string): number {
    return this.rows.get(scanId)?.length ?? 0;
  }
}

export class RecordingScanJobQueue implements ScanJobQueue {
  readonly jobs: ScanJob[] = [];
  failWith: Error | null = null;

  enqueue(job: ScanJob): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.jobs.push(job);
    return Promise.resolve();
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
