import {
  ExecuteScanCommand,
  FailScanCommand,
  ScanFailure,
  ScanOwnershipLostError,
  type ExecuteScanResult,
  type Logger,
  type ScanJobQueue,
} from '@code-guardian/core';
import { LOGGER, SCAN_JOB_QUEUE } from '@code-guardian/nest-common';
import { Inject, type OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { SCAN_QUEUE_NAME, WORKER_CONCURRENCY, scanJobDataSchema } from './scan-queue';
import { toWorkerError } from './to-worker-error';

export const STALLED_REASON = 'Scan was interrupted repeatedly (worker crashed or was stopped)';
const GENERIC_FAILURE = 'Scan failed';
/** BullMQ's failedReason when a job exceeded maxStalledCount. */
const STALLED_TOO_OFTEN = /stalled more than allowable limit/i;

/**
 * BullMQ transport: turns a job into an ExecuteScanCommand and maps the outcome for retries.
 * It also closes the gaps where BullMQ gives up on a job without our code running:
 * a scan whose job is dead must not stay Queued/Scanning forever.
 */
@Processor(SCAN_QUEUE_NAME)
export class ScanProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly commandBus: CommandBus,
    @Inject(WORKER_CONCURRENCY) private readonly concurrency: number,
    @Inject(SCAN_JOB_QUEUE) private readonly jobs: ScanJobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    super();
  }

  /** @Processor options are static, so concurrency from env is applied once the worker exists. */
  onApplicationBootstrap(): void {
    this.worker.concurrency = this.concurrency;
  }

  override async process(job: Job): Promise<ExecuteScanResult> {
    const data = scanJobDataSchema.safeParse(job.data);
    if (!data.success) {
      throw new UnrecoverableError(`Invalid scan job payload (job ${job.id ?? 'unknown'})`);
    }
    const command = new ExecuteScanCommand(
      data.data.scanId,
      job.attemptsMade + 1,
      job.opts.attempts ?? 1,
    );
    try {
      return await this.commandBus.execute<ExecuteScanCommand, ExecuteScanResult>(command);
    } catch (error: unknown) {
      throw toWorkerError(error);
    }
  }

  /**
   * Final failure of an attempt we ran. The use case normally records it already; this is
   * the safety net for failures outside it (e.g. the failure write itself was lost).
   * FailScan is a no-op for terminal scans.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    const cause = error instanceof UnrecoverableError ? error.cause : error;
    const isFinal =
      error instanceof UnrecoverableError ||
      STALLED_TOO_OFTEN.test(error.message) ||
      (job ? job.attemptsMade >= (job.opts.attempts ?? 1) : false);
    this.logger.warn('Scan job attempt failed', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      final: isFinal,
      error: error.message,
    });
    // A superseded attempt must not fail a scan that a newer attempt now owns.
    if (!job || !isFinal || cause instanceof ScanOwnershipLostError) return;
    const data = scanJobDataSchema.safeParse(job.data);
    if (!data.success) return;
    const reason =
      cause instanceof ScanFailure
        ? cause.publicMessage
        : STALLED_TOO_OFTEN.test(error.message)
          ? STALLED_REASON
          : GENERIC_FAILURE;
    await this.failScan(data.data.scanId, reason);
  }

  /**
   * A job's lock expired (its worker died or hung). BullMQ re-queues it, or, past
   * maxStalledCount, moves it to failed without calling process(). `failed` is normally
   * emitted for that too (handled above); this check is a second line of defence, with
   * the reaper as the third. Job ids are scan ids by design (see BullMqScanJobQueue).
   */
  @OnWorkerEvent('stalled')
  async onStalled(jobId: string): Promise<void> {
    this.logger.warn('Scan job stalled', { jobId });
    try {
      if ((await this.jobs.getJobState(jobId)) === 'failed') {
        await this.failScan(jobId, STALLED_REASON);
      }
    } catch (error: unknown) {
      // The reaper will catch it on its next pass.
      this.logger.error('Could not reconcile stalled job', { jobId, error });
    }
  }

  /** Connection-level errors; without a listener an EventEmitter 'error' would crash the process. */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error('Scan worker error', { error: error.message });
  }

  private async failScan(scanId: string, reason: string): Promise<void> {
    try {
      await this.commandBus.execute(new FailScanCommand(scanId, reason));
    } catch (error: unknown) {
      this.logger.error('Could not mark scan as failed', { scanId, error });
    }
  }
}
