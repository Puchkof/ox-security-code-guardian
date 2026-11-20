import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { type PrismaClient } from '@prisma/client';
import { RepoUrl, Scan, ScanStatus, Severity, type Vulnerability } from '@code-guardian/core';
import { describeWithDocker } from '../../test/docker';
import { createPrismaClient } from './prisma-client';
import { PrismaScanRepository } from './prisma-scan.repository';
import {
  InvalidCursorError,
  PrismaVulnerabilityRepository,
} from './prisma-vulnerability.repository';

const PACKAGE_DIR = path.resolve(__dirname, '../..');

function applyMigrations(databaseUrl: string): void {
  execFileSync(
    path.join(PACKAGE_DIR, 'node_modules/.bin/prisma'),
    ['migrate', 'deploy', '--schema', path.join(PACKAGE_DIR, 'prisma/schema.prisma')],
    { cwd: PACKAGE_DIR, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
  );
}

const SCAN_ID = '0b9f8a4e-5d0c-4b8e-9c55-6f4a2f1d7a01';
const OTHER_SCAN_ID = '0b9f8a4e-5d0c-4b8e-9c55-6f4a2f1d7a02';
const repoUrl = RepoUrl.create('https://github.com/OWASP/NodeGoat');

function finding(index: number): Vulnerability {
  return {
    vulnerabilityId: `CVE-2026-${String(index).padStart(4, '0')}`,
    pkgName: `pkg-${index}`,
    installedVersion: '1.0.0',
    fixedVersion: index % 2 === 0 ? '1.0.1' : null,
    severity: Severity.Critical,
    title: index % 3 === 0 ? null : `Title ${index}`,
    primaryUrl: null,
    target: 'package-lock.json',
  };
}

describeWithDocker('Prisma repositories (PostgreSQL)', () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let scans: PrismaScanRepository;
  let vulnerabilities: PrismaVulnerabilityRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const url = container.getConnectionUri();
    applyMigrations(url);
    prisma = createPrismaClient(url);
    scans = new PrismaScanRepository(prisma);
    vulnerabilities = new PrismaVulnerabilityRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    await prisma.scan.deleteMany();
  });

  describe('PrismaScanRepository', () => {
    it('inserts then updates the aggregate (upsert) and restores it faithfully', async () => {
      const t0 = new Date('2026-11-20T10:00:00.000Z');
      const scan = Scan.queue(SCAN_ID, repoUrl, t0);
      await scans.save(scan);

      const queued = await scans.findById(SCAN_ID);
      expect(queued?.toSnapshot()).toEqual(scan.toSnapshot());

      scan.start(new Date('2026-11-20T10:00:01.000Z'));
      scan.finish(7, new Date('2026-11-20T10:05:00.123Z'));
      await scans.save(scan);

      const finished = await scans.findById(SCAN_ID);
      expect(finished?.status).toBe(ScanStatus.Finished);
      expect(finished?.repoUrl).toBeInstanceOf(RepoUrl);
      expect(finished?.toSnapshot()).toEqual(scan.toSnapshot());
      expect(await prisma.scan.count()).toBe(1);
    });

    it('stores the failure reason', async () => {
      const scan = Scan.queue(SCAN_ID, repoUrl, new Date());
      scan.fail('Repository not found', new Date());
      await scans.save(scan);
      expect((await scans.findById(SCAN_ID))?.toSnapshot().failureReason).toBe(
        'Repository not found',
      );
    });

    it('returns null for unknown and for non-uuid ids', async () => {
      await expect(scans.findById(OTHER_SCAN_ID)).resolves.toBeNull();
      await expect(scans.findById('not-a-uuid')).resolves.toBeNull();
    });
  });

  describe('PrismaVulnerabilityRepository', () => {
    beforeEach(async () => {
      await scans.save(Scan.queue(SCAN_ID, repoUrl, new Date()));
      await scans.save(Scan.queue(OTHER_SCAN_ID, repoUrl, new Date()));
    });

    it('appends batches and pages through them with an opaque keyset cursor', async () => {
      const all = Array.from({ length: 25 }, (_, i) => finding(i));
      await vulnerabilities.appendBatch(SCAN_ID, all.slice(0, 10));
      await vulnerabilities.appendBatch(SCAN_ID, all.slice(10));
      await vulnerabilities.appendBatch(OTHER_SCAN_ID, [finding(999)]);
      await vulnerabilities.appendBatch(SCAN_ID, []);

      const seen: Vulnerability[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await vulnerabilities.findByScan(SCAN_ID, { limit: 10, cursor });
        seen.push(...page.items);
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor !== null);

      expect(pages).toBe(3);
      expect(seen).toEqual(all);
    });

    it('returns no next cursor when the last page is exactly full', async () => {
      await vulnerabilities.appendBatch(SCAN_ID, [finding(1), finding(2)]);
      const page = await vulnerabilities.findByScan(SCAN_ID, { limit: 2, cursor: null });
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('deletes by scan, and the scan delete cascades', async () => {
      await vulnerabilities.appendBatch(SCAN_ID, [finding(1)]);
      await vulnerabilities.appendBatch(OTHER_SCAN_ID, [finding(2)]);

      await vulnerabilities.deleteByScan(SCAN_ID);
      expect(
        (await vulnerabilities.findByScan(SCAN_ID, { limit: 10, cursor: null })).items,
      ).toEqual([]);

      await prisma.scan.delete({ where: { id: OTHER_SCAN_ID } });
      expect(await prisma.vulnerability.count()).toBe(0);
    });

    it('rejects a malformed cursor and tolerates a non-uuid scan id', async () => {
      await expect(
        vulnerabilities.findByScan(SCAN_ID, { limit: 10, cursor: 'abc' }),
      ).rejects.toBeInstanceOf(InvalidCursorError);
      await expect(
        vulnerabilities.findByScan('nope', { limit: 10, cursor: null }),
      ).resolves.toEqual({ items: [], nextCursor: null });
      await expect(vulnerabilities.deleteByScan('nope')).resolves.toBeUndefined();
    });
  });
});
