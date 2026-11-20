import { SCAN_QUEUE } from '@code-guardian/infrastructure';
import { z } from 'zod';

/** Same constant as the producer (BullMqScanJobQueue), so the two can never drift apart. */
export const SCAN_QUEUE_NAME = SCAN_QUEUE;

export const scanJobDataSchema = z.object({ scanId: z.string().min(1) });
export type ScanJobData = z.output<typeof scanJobDataSchema>;

/** Injection token for the processor's concurrency (WORKER_CONCURRENCY). */
export const WORKER_CONCURRENCY = Symbol.for('code-guardian:WorkerConcurrency');
