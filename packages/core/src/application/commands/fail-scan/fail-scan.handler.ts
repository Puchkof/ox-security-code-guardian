import { ConcurrentScanUpdateError } from '../../errors';
import {
  type Clock,
  type Logger,
  type ScanRepository,
  type VulnerabilityRepository,
} from '../../ports';
import { type FailScanCommand, type FailScanResult } from './fail-scan.command';

/**
 * Terminal failure decided outside the scan pipeline: the job runner gave up on the job
 * (e.g. it stalled more often than allowed after repeated worker crashes), or the reaper
 * found a scan nobody is working on. Idempotent and safe to race with a live attempt:
 * the version check makes exactly one writer win.
 */
export class FailScanHandler {
  constructor(
    private readonly scans: ScanRepository,
    private readonly vulnerabilities: VulnerabilityRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(command: FailScanCommand): Promise<FailScanResult> {
    const scan = await this.scans.findById(command.scanId);
    if (!scan) return 'not-found';
    if (scan.isTerminal) return 'already-terminal';

    scan.fail(command.reason, this.clock.now());
    try {
      await this.scans.save(scan);
    } catch (error: unknown) {
      if (error instanceof ConcurrentScanUpdateError) return 'conflict';
      throw error;
    }
    await this.vulnerabilities.deleteByScan(scan.id);
    this.logger.warn('Scan marked failed', { scanId: scan.id, reason: command.reason });
    return 'failed';
  }
}
