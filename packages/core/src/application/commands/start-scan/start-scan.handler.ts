import { RepoUrl, Scan, ScanStatus } from '../../../domain';
import { QueueUnavailableError } from '../../errors';
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
      // Do not leave an orphan "Queued" scan that no worker will ever pick up.
      // (Production upgrade: a transactional outbox makes save+enqueue atomic.)
      scan.fail('Could not enqueue scan', this.clock.now());
      await this.scans.save(scan);
      this.logger.error('Failed to enqueue scan', { scanId: scan.id, error });
      throw new QueueUnavailableError({ cause: error });
    }

    this.logger.info('Scan queued', { scanId: scan.id, repoUrl: repoUrl.value });
    return { scanId: scan.id, status: ScanStatus.Queued };
  }
}
