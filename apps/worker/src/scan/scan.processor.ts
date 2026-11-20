import { ExecuteScanCommand, type ExecuteScanResult, type Logger } from '@code-guardian/core';
import { Inject, type OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { SCAN_QUEUE_NAME, WORKER_CONCURRENCY, scanJobDataSchema } from './scan-queue';
import { LOGGER } from '../shared/port.tokens';
import { toWorkerError } from './to-worker-error';

/** BullMQ transport: turns a job into an ExecuteScanCommand and maps the outcome for retries. */
@Processor(SCAN_QUEUE_NAME)
export class ScanProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly commandBus: CommandBus,
    @Inject(WORKER_CONCURRENCY) private readonly concurrency: number,
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

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.warn('Scan job attempt failed', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      unrecoverable: error instanceof UnrecoverableError,
      error: error.message,
    });
  }

  /** Connection-level errors; without a listener an EventEmitter 'error' would crash the process. */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error('Scan worker error', { error: error.message });
  }
}
