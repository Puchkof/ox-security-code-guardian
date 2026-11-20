import {
  type PrismaClient,
  type Scan as ScanRow,
  type ScanStatus as ScanStatusRow,
} from '@prisma/client';
import { RepoUrl, Scan, ScanStatus, type ScanRepository } from '@code-guardian/core';
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

/** Persists the Scan aggregate as one row; the aggregate's snapshot is the only contract. */
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
    };
    await this.prisma.scan.upsert({
      where: { id: snapshot.id },
      create: { id: snapshot.id, ...data },
      update: data,
    });
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
  });
}
