export interface ScanJob {
  readonly scanId: string;
}

/**
 * State of a scan's job in the queue, as far as the reaper needs to know:
 * `pending` (waiting/delayed/prioritized), `active`, `completed`, `failed`, or `missing`.
 */
export type ScanJobState = 'pending' | 'active' | 'completed' | 'failed' | 'missing';

/** Hands a scan to the background workers. */
export interface ScanJobQueue {
  enqueue(job: ScanJob): Promise<void>;
  getJobState(scanId: string): Promise<ScanJobState>;
}
