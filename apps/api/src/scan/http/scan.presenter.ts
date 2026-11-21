import { type ScanStatus, type ScanView, type Vulnerability } from '@code-guardian/core';

/** JSON shape of GET /api/scan/:scanId. */
export interface ScanResponse {
  readonly id: string;
  readonly repoUrl: string;
  readonly status: ScanStatus;
  readonly failureReason: string | null;
  readonly criticalCount: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** null unless status is Finished. */
  readonly criticalVulnerabilities: readonly Vulnerability[] | null;
  readonly nextCursor: string | null;
}

export function toScanResponse(view: ScanView): ScanResponse {
  return {
    id: view.id,
    repoUrl: view.repoUrl,
    status: view.status,
    failureReason: view.failureReason,
    criticalCount: view.criticalCount,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
    startedAt: view.startedAt?.toISOString() ?? null,
    finishedAt: view.finishedAt?.toISOString() ?? null,
    criticalVulnerabilities: view.criticalVulnerabilities,
    nextCursor: view.nextCursor,
  };
}
