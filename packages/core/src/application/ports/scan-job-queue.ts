export interface ScanJob {
  readonly scanId: string;
}

/** Hands a scan to the background workers. */
export interface ScanJobQueue {
  enqueue(job: ScanJob): Promise<void>;
}
