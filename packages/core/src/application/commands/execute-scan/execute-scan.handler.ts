import { ScanNotFoundError, Severity, type Scan } from '../../../domain';
import {
  ConcurrentScanUpdateError,
  ScanOwnershipLostError,
  toScanFailure,
  type ScanFailure,
} from '../../errors';
import {
  type Clock,
  type IdGenerator,
  type Logger,
  type ReportParser,
  type RepositoryCloner,
  type ScanRepository,
  type ScanWorkspace,
  type SecurityScanner,
  type VulnerabilityRepository,
  type WorkspaceProvider,
} from '../../ports';
import { inBatches } from '../../shared/batch';
import { type ExecuteScanCommand, type ExecuteScanResult } from './execute-scan.command';

export interface ScanPipelineConfig {
  readonly cloneTimeoutMs: number;
  readonly scanTimeoutMs: number;
  /** Deadline for streaming the report into storage (parse + batched inserts). */
  readonly parseTimeoutMs: number;
  /** Number of findings held in memory before they are flushed to storage. */
  readonly batchSize: number;
}

const CRITICAL_ONLY: ReadonlySet<Severity> = new Set([Severity.Critical]);

/**
 * The background job: clone → scan → stream-parse → store criticals → clean up.
 *
 * Memory stays bounded by `batchSize` findings whatever the report size: the parser is
 * pulled one batch at a time and each batch is awaited into storage before the next is read.
 *
 * Concurrency: every attempt gets a fresh run id and every save is version-checked. If a
 * newer attempt (a redelivered stalled job) takes over, this attempt's saves fail with
 * ConcurrentScanUpdateError and it stops without touching the scan; findings it already
 * wrote belong to its own run id, so they are never shown.
 */
export class ExecuteScanHandler {
  constructor(
    private readonly scans: ScanRepository,
    private readonly vulnerabilities: VulnerabilityRepository,
    private readonly workspaces: WorkspaceProvider,
    private readonly cloner: RepositoryCloner,
    private readonly scanner: SecurityScanner,
    private readonly parser: ReportParser,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly config: ScanPipelineConfig,
  ) {}

  async execute(command: ExecuteScanCommand): Promise<ExecuteScanResult> {
    const scan = await this.scans.findById(command.scanId);
    if (!scan) throw new ScanNotFoundError(command.scanId);
    if (scan.isTerminal) {
      // Duplicate delivery of a job that already completed: nothing to do.
      return { outcome: 'skipped', reason: `Scan is already ${scan.status}` };
    }

    const runId = this.ids.next();
    let workspace: ScanWorkspace | undefined;
    try {
      scan.start(runId, this.clock.now());
      await this.scans.save(scan);

      workspace = await this.workspaces.create(scan.id);
      const criticalCount = await this.runPipeline(scan, runId, workspace);

      scan.finish(criticalCount, this.clock.now());
      await this.scans.save(scan);
      this.logger.info('Scan finished', { scanId: scan.id, criticalCount });
      await this.cleanUpOtherRuns(scan.id, runId);
      return { outcome: 'finished', criticalCount };
    } catch (error: unknown) {
      if (error instanceof ConcurrentScanUpdateError) {
        this.logger.warn('Scan attempt lost ownership; stopping without changes', {
          scanId: scan.id,
          runId,
        });
        throw new ScanOwnershipLostError(scan.id, { cause: error });
      }
      const failure = toScanFailure(error);
      await this.recordFailure(scan, failure, command);
      throw failure;
    } finally {
      await this.disposeQuietly(scan.id, workspace);
    }
  }

  private async runPipeline(scan: Scan, runId: string, workspace: ScanWorkspace): Promise<number> {
    await this.cloner.clone(
      scan.repoUrl,
      workspace.sourceDir,
      AbortSignal.timeout(this.config.cloneTimeoutMs),
    );
    await this.scanner.scan(
      workspace.sourceDir,
      workspace.reportFile,
      AbortSignal.timeout(this.config.scanTimeoutMs),
    );

    const findings = this.parser.stream(workspace.reportFile, {
      severities: CRITICAL_ONLY,
      signal: AbortSignal.timeout(this.config.parseTimeoutMs),
    });
    let count = 0;
    for await (const batch of inBatches(findings, this.config.batchSize)) {
      await this.vulnerabilities.appendBatch(scan.id, runId, batch);
      count += batch.length;
    }
    return count;
  }

  /**
   * Moves the scan to Queued (retry pending) or Failed. Never throws: a storage error here
   * must not replace the original failure, which is what BullMQ needs to decide on retries.
   * If this write is lost, the reaper eventually fails the scan.
   */
  private async recordFailure(
    scan: Scan,
    failure: ScanFailure,
    command: ExecuteScanCommand,
  ): Promise<void> {
    const willRetry = failure.retryable && command.attempt < command.maxAttempts;
    this.logger.warn('Scan attempt failed', {
      scanId: scan.id,
      code: failure.code,
      detail: failure.message,
      attempt: command.attempt,
      willRetry,
      cause: failure.cause,
    });
    try {
      if (willRetry) {
        scan.requeue(failure.publicMessage, this.clock.now());
      } else {
        scan.fail(failure.publicMessage, this.clock.now());
      }
      await this.scans.save(scan);
      if (!willRetry) await this.vulnerabilities.deleteByScan(scan.id);
    } catch (persistError: unknown) {
      this.logger.error('Could not record scan failure', {
        scanId: scan.id,
        code: failure.code,
        error: persistError,
      });
    }
  }

  private async cleanUpOtherRuns(scanId: string, runId: string): Promise<void> {
    try {
      await this.vulnerabilities.deleteOtherRuns(scanId, runId);
    } catch (error: unknown) {
      // Rows of other runs are invisible to readers, so this is housekeeping only.
      this.logger.warn('Could not delete findings of superseded runs', { scanId, error });
    }
  }

  private async disposeQuietly(
    scanId: string,
    workspace: ScanWorkspace | undefined,
  ): Promise<void> {
    if (!workspace) return;
    try {
      await workspace.dispose();
    } catch (error: unknown) {
      // Cleanup failure must not hide the real outcome; the startup sweep removes leftovers.
      this.logger.error('Failed to clean up scan workspace', { scanId, error });
    }
  }
}
