import {
  Prisma,
  type PrismaClient,
  type Scan as ScanRow,
  type ScanStatus as ScanStatusRow,
} from '@prisma/client';
import {
  ConcurrentScanUpdateError,
  RepoUrl,
  Scan,
  ScanStatus,
  type ScanRepository,
} from '@code-guardian/core';
import { isUuid } from './prisma-client';

const STATUS_FROM_ROW: Readonly<Record<ScanStatusRow, ScanStatus>> = {
  Queued: ScanStatus.Queued,
  Scanning: ScanStatus.Scanning,
  Finished: ScanStatus.Finished,
  Failed: ScanStatus.Failed,
};

const STATUS_TO_ROW: Readonly<Record<ScanStatus, ScanStatusRow>> = {
  Queued: 'Queued',
  Scanning: 'Scanning',
  Finished: 'Finished',
  Failed: 'Failed',
};

/**
 * Persists the Scan aggregate as one row; the aggregate's snapshot is the only contract.
 * Writes are version-checked (optimistic concurrency): an update only applies when the
 * stored version still equals the one the aggregate was loaded with.
 */
export class PrismaScanRepository implements ScanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(scan: Scan): Promise<void> {
    const snapshot = scan.toSnapshot();
    const data = {
      repoUrl: snapshot.repoUrl.value,
      status: STATUS_TO_ROW[snapshot.status],
      criticalCount: snapshot.criticalCount,
      failureReason: snapshot.failureReason,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      startedAt: snapshot.startedAt,
      finishedAt: snapshot.finishedAt,
      runId: snapshot.runId,
    };

    if (snapshot.version === 0) {
      try {
        await this.prisma.scan.create({ data: { id: snapshot.id, ...data, version: 1 } });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConcurrentScanUpdateError(snapshot.id);
        }
        throw error;
      }
      scan.markPersisted(1);
      return;
    }

    const next = snapshot.version + 1;
    const { count } = await this.prisma.scan.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: { ...data, version: next },
    });
    if (count === 0) throw new ConcurrentScanUpdateError(snapshot.id);
    scan.markPersisted(next);
  }

  async findNonTerminalUpdatedBefore(before: Date, limit: number): Promise<Scan[]> {
    const rows = await this.prisma.scan.findMany({
      where: { status: { in: ['Queued', 'Scanning'] }, updatedAt: { lt: before } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toAggregate);
  }

  async findById(id: string): Promise<Scan | null> {
    if (!isUuid(id)) return null;
    const row = await this.prisma.scan.findUnique({ where: { id } });
    return row ? toAggregate(row) : null;
  }
}

function toAggregate(row: ScanRow): Scan {
  return Scan.restore({
    id: row.id,
    repoUrl: RepoUrl.create(row.repoUrl),
    status: STATUS_FROM_ROW[row.status],
    criticalCount: row.criticalCount,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    runId: row.runId,
    version: row.version,
  });
}
