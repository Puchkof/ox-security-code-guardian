import { z } from 'zod';

/** Must match the producer (BullMqScanJobQueue). */
export const SCAN_QUEUE_NAME = 'scans';

export const scanJobDataSchema = z.object({ scanId: z.string().min(1) });
export type ScanJobData = z.output<typeof scanJobDataSchema>;

/** Injection token for the processor's concurrency (WORKER_CONCURRENCY). */
export const WORKER_CONCURRENCY = Symbol.for('code-guardian:WorkerConcurrency');
