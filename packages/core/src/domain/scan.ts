import { InvalidScanTransitionError } from './errors';
import { type RepoUrl } from './repo-url';
import { ScanStatus, TERMINAL_STATUSES } from './scan-status';

export interface ScanSnapshot {
  readonly id: string;
  readonly repoUrl: RepoUrl;
  readonly status: ScanStatus;
  readonly criticalCount: number | null;
  /** Reason of the final failure, or the last transient error while a retry is pending. */
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  /**
   * Identifies the attempt that owns the stored findings. Each start() gets a fresh id,
   * so findings written by a stale, still-running attempt are never shown.
   */
  readonly runId: string | null;
  /**
   * Optimistic-concurrency version: 0 = never persisted. Repositories only write when
   * the stored version still matches, so concurrent writers cannot silently overwrite each other.
   */
  readonly version: number;
}

/**
 * Scan aggregate. Owns the lifecycle state machine:
 *
 *   Queued ──start──▶ Scanning ──finish──▶ Finished
 *     │                 │  ▲ │
 *     │                 │  └─┘ start (stalled job picked up again)
 *     │                 ├──requeue──▶ Queued   (transient failure, retry pending)
 *     └──────fail───────┴──fail─────▶ Failed
 */
export class Scan {
  private constructor(private state: ScanSnapshot) {}

  static queue(id: string, repoUrl: RepoUrl, now: Date): Scan {
    return new Scan({
      id,
      repoUrl,
      status: ScanStatus.Queued,
      criticalCount: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      runId: null,
      version: 0,
    });
  }

  /** Rehydrates an aggregate from persistence; no rules are applied. */
  static restore(snapshot: ScanSnapshot): Scan {
    return new Scan({ ...snapshot });
  }

  get id(): string {
    return this.state.id;
  }

  get repoUrl(): RepoUrl {
    return this.state.repoUrl;
  }

  get status(): ScanStatus {
    return this.state.status;
  }

  get runId(): string | null {
    return this.state.runId;
  }

  get version(): number {
    return this.state.version;
  }

  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  get isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this.state.status);
  }

  start(runId: string, now: Date): void {
    this.assertTransition([ScanStatus.Queued, ScanStatus.Scanning], ScanStatus.Scanning);
    this.state = {
      ...this.state,
      status: ScanStatus.Scanning,
      runId,
      startedAt: this.state.startedAt ?? now,
      updatedAt: now,
    };
  }

  finish(criticalCount: number, now: Date): void {
    this.assertTransition([ScanStatus.Scanning], ScanStatus.Finished);
    this.state = {
      ...this.state,
      status: ScanStatus.Finished,
      criticalCount,
      failureReason: null,
      finishedAt: now,
      updatedAt: now,
    };
  }

  /** A transient failure happened and the job will be retried. */
  requeue(reason: string, now: Date): void {
    this.assertTransition([ScanStatus.Scanning], ScanStatus.Queued);
    this.state = {
      ...this.state,
      status: ScanStatus.Queued,
      failureReason: reason,
      updatedAt: now,
    };
  }

  fail(reason: string, now: Date): void {
    this.assertTransition([ScanStatus.Queued, ScanStatus.Scanning], ScanStatus.Failed);
    this.state = {
      ...this.state,
      status: ScanStatus.Failed,
      criticalCount: null,
      failureReason: reason,
      finishedAt: now,
      updatedAt: now,
    };
  }

  /** Called by repositories after a successful write. */
  markPersisted(version: number): void {
    this.state = { ...this.state, version };
  }

  toSnapshot(): ScanSnapshot {
    return { ...this.state };
  }

  private assertTransition(allowedFrom: readonly ScanStatus[], to: ScanStatus): void {
    if (!allowedFrom.includes(this.state.status)) {
      throw new InvalidScanTransitionError(this.state.status, to);
    }
  }
}
