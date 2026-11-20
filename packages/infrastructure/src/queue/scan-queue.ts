import { Queue, type ConnectionOptions, type DefaultJobOptions } from 'bullmq';
import { type ScanJob, type ScanJobQueue } from '@code-guardian/core';

/** Queue shared by the API (producer) and the worker (consumer). */
export const SCAN_QUEUE = 'scans';
export const SCAN_JOB_NAME = 'execute-scan';

/** Payload of a scan job: just the id, the worker reloads the scan from the database. */
export interface ScanJobData {
  readonly scanId: string;
}

const HOUR_S = 60 * 60;

/**
 * Retries are for transient failures (network, disk temporarily full). The worker
 * marks non-retryable failures with BullMQ's UnrecoverableError so they stop at once.
 */
export const DEFAULT_SCAN_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 24 * HOUR_S, count: 1_000 },
  removeOnFail: { age: 7 * 24 * HOUR_S, count: 5_000 },
} as const satisfies DefaultJobOptions;

export type ScanQueue = Queue<ScanJobData, void, typeof SCAN_JOB_NAME>;

/** Creates the producer-side queue with the default job options. The caller owns `close()`. */
export function createScanQueue(connection: ConnectionOptions, prefix?: string): ScanQueue {
  return new Queue<ScanJobData, void, typeof SCAN_JOB_NAME>(SCAN_QUEUE, {
    connection,
    defaultJobOptions: DEFAULT_SCAN_JOB_OPTIONS,
    ...(prefix === undefined ? {} : { prefix }),
  });
}

export interface BullMqScanJobQueueOptions {
  /**
   * Upper bound on one enqueue. When Redis is down the client would otherwise keep the
   * command queued and the HTTP request would hang; failing fast lets StartScan
   * mark the scan failed and answer 503.
   */
  readonly enqueueTimeoutMs?: number;
}

const DEFAULT_ENQUEUE_TIMEOUT_MS = 5_000;

export class EnqueueTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Enqueue did not complete within ${timeoutMs}ms`);
    this.name = 'EnqueueTimeoutError';
  }
}

/**
 * ScanJobQueue on BullMQ. `jobId = scanId`, so enqueueing the same scan twice
 * (e.g. a client retry) does not create a second job.
 */
export class BullMqScanJobQueue implements ScanJobQueue {
  private readonly enqueueTimeoutMs: number;

  constructor(
    private readonly queue: ScanQueue,
    options: BullMqScanJobQueueOptions = {},
  ) {
    this.enqueueTimeoutMs = options.enqueueTimeoutMs ?? DEFAULT_ENQUEUE_TIMEOUT_MS;
  }

  async enqueue(job: ScanJob): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new EnqueueTimeoutError(this.enqueueTimeoutMs));
      }, this.enqueueTimeoutMs);
      timer.unref();
    });
    try {
      await Promise.race([
        this.queue.add(SCAN_JOB_NAME, { scanId: job.scanId }, { jobId: job.scanId }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
