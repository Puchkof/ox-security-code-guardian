import { ScanNotFoundError, Severity, type Scan } from '../../../domain';
import { toScanFailure } from '../../errors';
import {
  type Clock,
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
  /** Number of findings held in memory before they are flushed to storage. */
  readonly batchSize: number;
}

const CRITICAL_ONLY: ReadonlySet<Severity> = new Set([Severity.Critical]);

/**
 * The background job: clone → scan → stream-parse → store criticals → clean up.
 * Memory stays bounded by `batchSize` findings whatever the report size, because
 * the parser is pulled one batch at a time and each batch is awaited into storage
 * before the next is read.
 */
export class ExecuteScanHandler {
  constructor(
    private readonly scans: ScanRepository,
    private readonly vulnerabilities: VulnerabilityRepository,
    private readonly workspaces: WorkspaceProvider,
    private readonly cloner: RepositoryCloner,
    private readonly scanner: SecurityScanner,
    private readonly parser: ReportParser,
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

    scan.start(this.clock.now());
    await this.scans.save(scan);
    // A previous, interrupted attempt may have stored a partial result.
    await this.vulnerabilities.deleteByScan(scan.id);

    let workspace: ScanWorkspace | undefined;
    try {
      workspace = await this.workspaces.create(scan.id);
      const criticalCount = await this.runPipeline(scan, workspace);
      scan.finish(criticalCount, this.clock.now());
      await this.scans.save(scan);
      this.logger.info('Scan finished', { scanId: scan.id, criticalCount });
      return { outcome: 'finished', criticalCount };
    } catch (error: unknown) {
      const failure = toScanFailure(error);
      const willRetry = failure.retryable && command.attempt < command.maxAttempts;
      if (willRetry) {
        scan.requeue(failure.message, this.clock.now());
      } else {
        scan.fail(failure.message, this.clock.now());
        await this.vulnerabilities.deleteByScan(scan.id);
      }
      await this.scans.save(scan);
      this.logger.warn('Scan attempt failed', {
        scanId: scan.id,
        code: failure.code,
        attempt: command.attempt,
        willRetry,
        cause: failure.cause,
      });
      throw failure;
    } finally {
      await this.disposeQuietly(scan.id, workspace);
    }
  }

  private async runPipeline(scan: Scan, workspace: ScanWorkspace): Promise<number> {
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

    const findings = this.parser.stream(workspace.reportFile, { severities: CRITICAL_ONLY });
    let count = 0;
    for await (const batch of inBatches(findings, this.config.batchSize)) {
      await this.vulnerabilities.appendBatch(scan.id, batch);
      count += batch.length;
    }
    return count;
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
