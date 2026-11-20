import { RepoUrl, Scan, ScanStatus } from '../../../domain';
import { ConcurrentScanUpdateError, QueueUnavailableError } from '../../errors';
import {
  type Clock,
  type IdGenerator,
  type Logger,
  type ScanJobQueue,
  type ScanRepository,
} from '../../ports';
import { type StartScanCommand, type StartScanResult } from './start-scan.command';

/**
 * Validates the URL, stores the scan as Queued and hands it to the queue.
 * It never waits for the scan itself, so the HTTP request returns right away.
 */
export class StartScanHandler {
  constructor(
    private readonly scans: ScanRepository,
    private readonly queue: ScanJobQueue,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(command: StartScanCommand): Promise<StartScanResult> {
    const repoUrl = RepoUrl.create(command.repoUrl);
    const scan = Scan.queue(this.ids.next(), repoUrl, this.clock.now());
    await this.scans.save(scan);

    try {
      await this.queue.enqueue({ scanId: scan.id });
    } catch (error: unknown) {
      if (await this.markUnqueued(scan, error)) throw new QueueUnavailableError({ cause: error });
    }

    this.logger.info('Scan queued', { scanId: scan.id, repoUrl: repoUrl.value });
    return { scanId: scan.id, status: ScanStatus.Queued };
  }

  /**
   * Enqueue reported a failure. Fail the scan so no "Queued" orphan is left behind. But an
   * enqueue that timed out may still have landed, and a worker may already own the scan;
   * then the version check rejects our write and the scan is in fact running.
   * Returns true when the scan was failed (the client should see 503).
   * (Production upgrade: a transactional outbox makes save+enqueue atomic; the reaper
   * covers a crash between the two in the meantime.)
   */
  private async markUnqueued(scan: Scan, error: unknown): Promise<boolean> {
    this.logger.error('Failed to enqueue scan', { scanId: scan.id, error });
    try {
      scan.fail('Could not enqueue scan', this.clock.now());
      await this.scans.save(scan);
      return true;
    } catch (saveError: unknown) {
      if (saveError instanceof ConcurrentScanUpdateError) {
        this.logger.warn('Enqueue reported failure but a worker already picked the scan up', {
          scanId: scan.id,
        });
        return false;
      }
      throw saveError;
    }
  }
}
