import { type ScanStatus, type Vulnerability } from '../../../domain';

export class GetScanQuery {
  constructor(
    readonly scanId: string,
    readonly limit?: number,
    readonly cursor?: string | null,
  ) {}
}

export interface ScanView {
  readonly id: string;
  readonly repoUrl: string;
  readonly status: ScanStatus;
  readonly failureReason: string | null;
  readonly criticalCount: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  /** Present only when status is Finished. */
  readonly criticalVulnerabilities: readonly Vulnerability[] | null;
  readonly nextCursor: string | null;
}
