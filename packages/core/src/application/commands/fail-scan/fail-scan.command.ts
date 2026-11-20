/** Marks a scan Failed unless it already reached a terminal state. */
export class FailScanCommand {
  constructor(
    readonly scanId: string,
    /** Client-safe reason stored as failureReason. */
    readonly reason: string,
  ) {}
}

export type FailScanResult = 'failed' | 'already-terminal' | 'not-found' | 'conflict';
