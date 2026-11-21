export class ExecuteScanCommand {
  constructor(
    readonly scanId: string,
    /** 1-based number of this attempt. */
    readonly attempt: number,
    readonly maxAttempts: number,
  ) {}
}

export type ExecuteScanResult =
  | { readonly outcome: 'finished'; readonly criticalCount: number }
  | { readonly outcome: 'skipped'; readonly reason: string };
