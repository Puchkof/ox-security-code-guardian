import { ScanNotFoundError, ScanStatus } from '../../../domain';
import { type ScanRepository, type VulnerabilityRepository } from '../../ports';
import { type GetScanQuery, type ScanView } from './get-scan.query';

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
}

/** Read side: scan status, plus one page of criticals once the scan is Finished. */
export class GetScanHandler {
  constructor(
    private readonly scans: ScanRepository,
    private readonly vulnerabilities: VulnerabilityRepository,
  ) {}

  async execute(query: GetScanQuery): Promise<ScanView> {
    const scan = await this.scans.findById(query.scanId);
    if (!scan) throw new ScanNotFoundError(query.scanId);
    const snapshot = scan.toSnapshot();

    let criticalVulnerabilities: ScanView['criticalVulnerabilities'] = null;
    let nextCursor: string | null = null;
    if (snapshot.status === ScanStatus.Finished && snapshot.runId !== null) {
      const page = await this.vulnerabilities.findByScan(snapshot.id, snapshot.runId, {
        limit: clampLimit(query.limit),
        cursor: query.cursor ?? null,
      });
      criticalVulnerabilities = page.items;
      nextCursor = page.nextCursor;
    }

    return {
      id: snapshot.id,
      repoUrl: snapshot.repoUrl.value,
      status: snapshot.status,
      failureReason: snapshot.failureReason,
      criticalCount: snapshot.criticalCount,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      startedAt: snapshot.startedAt,
      finishedAt: snapshot.finishedAt,
      criticalVulnerabilities,
      nextCursor,
    };
  }
}
