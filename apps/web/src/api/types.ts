export const SCAN_STATUSES = ['Queued', 'Scanning', 'Finished', 'Failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export interface Vulnerability {
  vulnerabilityId: string;
  pkgName: string;
  installedVersion: string;
  fixedVersion: string | null;
  severity: string;
  title: string | null;
  primaryUrl: string | null;
  target: string;
}

export interface CreateScanResponse {
  scanId: string;
  status: ScanStatus;
}

export interface ScanResult {
  id: string;
  repoUrl: string;
  status: ScanStatus;
  failureReason: string | null;
  criticalCount: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  criticalVulnerabilities: Vulnerability[] | null;
  nextCursor: string | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}
