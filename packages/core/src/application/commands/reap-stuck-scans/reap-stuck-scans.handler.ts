import { ScanStatus, type Scan } from '../../../domain';
import { type Clock, type Logger, type ScanJobQueue, type ScanRepository } from '../../ports';
import { type FailScanHandler } from '../fail-scan/fail-scan.handler';
import { FailScanCommand } from '../fail-scan/fail-scan.command';
import { type ReapStuckScansCommand, type ReapStuckScansResult } from './reap-stuck-scans.command';

export interface ReaperConfig {
  /**
   * A Queued scan older than this whose job is gone (never enqueued, already failed or
   * completed) is failed. Queued scans with a pending job are left alone however old.
   */
  readonly queuedGraceMs: number;
  /**
   * Hard deadline for Scanning: longer than clone + scan + parse timeouts together, so an
   * attempt still inside its own timeouts is never reaped.
   */
  readonly scanningDeadlineMs: number;
}

export const REAPED_REASON = 'Scan was interrupted and did not complete';

/**
 * Safety net that reconciles the database with the queue, so no scan stays
 * Queued/Scanning forever. It catches:
 *  - jobs BullMQ failed on its own (stalled more than allowed after repeated worker crashes),
 *  - a crash between saving a scan and enqueueing it (Queued, but no job),
 *  - attempts that hung beyond every timeout.
 */
export class ReapStuckScansHandler {
  constructor(
    private readonly scans: ScanRepository,
    private readonly queue: ScanJobQueue,
    private readonly failScan: FailScanHandler,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly config: ReaperConfig,
  ) {}

  async execute(command: ReapStuckScansCommand): Promise<ReapStuckScansResult> {
    const now = this.clock.now().getTime();
    const horizon = new Date(
      now - Math.min(this.config.queuedGraceMs, this.config.scanningDeadlineMs),
    );
    const candidates = await this.scans.findNonTerminalUpdatedBefore(horizon, command.limit);

    let failed = 0;
    for (const scan of candidates) {
      if (!(await this.isStuck(scan, now))) continue;
      const outcome = await this.failScan.execute(new FailScanCommand(scan.id, REAPED_REASON));
      if (outcome === 'failed') failed += 1;
    }
    if (failed > 0)
      this.logger.warn('Reaped stuck scans', { failed, inspected: candidates.length });
    return { inspected: candidates.length, failed };
  }

  private async isStuck(scan: Scan, now: number): Promise<boolean> {
    const age = now - scan.updatedAt.getTime();
    if (scan.status === ScanStatus.Scanning) {
      if (age >= this.config.scanningDeadlineMs) return true;
      // A crashed attempt whose job BullMQ already failed: no need to wait for the deadline.
      return (await this.queue.getJobState(scan.id)) === 'failed';
    }
    if (age < this.config.queuedGraceMs) return false;
    const state = await this.queue.getJobState(scan.id);
    return state === 'missing' || state === 'failed' || state === 'completed';
  }
}
