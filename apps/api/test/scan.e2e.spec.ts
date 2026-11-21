import {
  ExecuteScanCommand,
  ExecuteScanHandler,
  ScanStatus,
  Severity,
  type ReportParser,
  type ScanRepository,
  type Vulnerability,
  type VulnerabilityRepository,
} from '@code-guardian/core';
import {
  FixedClock,
  type RecordingScanJobQueue,
  SequentialIdGenerator,
  SilentLogger,
} from '@code-guardian/core/testing';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import {
  CLOCK,
  ID_GENERATOR,
  SCAN_JOB_QUEUE,
  SCAN_REPOSITORY,
  VULNERABILITY_REPOSITORY,
} from '@code-guardian/nest-common';

const REPO = 'https://github.com/OWASP/NodeGoat';

function critical(id: string): Vulnerability {
  return {
    vulnerabilityId: id,
    pkgName: 'lodash',
    installedVersion: '4.17.0',
    fixedVersion: '4.17.21',
    severity: Severity.Critical,
    title: `Issue ${id}`,
    primaryUrl: null,
    target: 'package-lock.json',
  };
}

describe('Scan API (e2e, in-memory adapters)', () => {
  let app: INestApplication<App>;
  let clock: FixedClock;

  beforeEach(async () => {
    clock = new FixedClock();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot({ adapters: 'in-memory' })],
    })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(ID_GENERATOR)
      .useValue(new SequentialIdGenerator())
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** Runs the worker use case directly against the app's fakes, as the worker would. */
  async function runScan(scanId: string, findings: readonly Vulnerability[]): Promise<void> {
    const parser: ReportParser = {
      async *stream() {
        await Promise.resolve();
        yield* findings;
      },
    };
    const handler = new ExecuteScanHandler(
      app.get<ScanRepository>(SCAN_REPOSITORY),
      app.get<VulnerabilityRepository>(VULNERABILITY_REPOSITORY),
      {
        create: (id) =>
          Promise.resolve({
            sourceDir: `/tmp/${id}`,
            reportFile: `/tmp/${id}.json`,
            dispose: () => Promise.resolve(),
          }),
      },
      { clone: () => Promise.resolve() },
      { scan: () => Promise.resolve() },
      parser,
      new SequentialIdGenerator('run'),
      clock,
      new SilentLogger(),
      { cloneTimeoutMs: 1000, scanTimeoutMs: 1000, parseTimeoutMs: 1000, batchSize: 2 },
    );
    await handler.execute(new ExecuteScanCommand(scanId, 1, 1));
  }

  describe('REST', () => {
    it('POST /api/scan queues the scan and records a job', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/scan')
        .send({ repoUrl: REPO })
        .expect(202);

      expect(response.body).toEqual({ scanId: 'scan-1', status: 'Queued' });
      expect(app.get<RecordingScanJobQueue>(SCAN_JOB_QUEUE).jobs).toEqual([{ scanId: 'scan-1' }]);
    });

    it('POST /api/scan rejects a missing repoUrl with 400', async () => {
      const response = await request(app.getHttpServer()).post('/api/scan').send({}).expect(400);
      expect(response.body).toEqual({
        error: {
          code: 'VALIDATION_FAILED',
          message: expect.stringContaining('repoUrl') as unknown,
        },
      });
    });

    it('POST /api/scan rejects a non-GitHub URL with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/scan')
        .send({ repoUrl: 'file:///etc/passwd' })
        .expect(400);
      expect(response.body).toMatchObject({ error: { code: 'INVALID_REPO_URL' } });
      expect(app.get<RecordingScanJobQueue>(SCAN_JOB_QUEUE).jobs).toHaveLength(0);
    });

    it('POST /api/scan maps a queue outage to 503', async () => {
      app.get<RecordingScanJobQueue>(SCAN_JOB_QUEUE).failWith = new Error('redis down');
      const response = await request(app.getHttpServer())
        .post('/api/scan')
        .send({ repoUrl: REPO })
        .expect(503);
      expect(response.body).toMatchObject({ error: { code: 'QUEUE_UNAVAILABLE' } });
      expect(JSON.stringify(response.body)).not.toContain('redis down');
    });

    it('GET /api/scan/:id returns 404 for an unknown scan', async () => {
      const response = await request(app.getHttpServer()).get('/api/scan/nope').expect(404);
      expect(response.body).toEqual({
        error: { code: 'SCAN_NOT_FOUND', message: 'Scan nope was not found' },
      });
    });

    it('GET /api/scan/:id shows a queued scan without vulnerabilities', async () => {
      await request(app.getHttpServer()).post('/api/scan').send({ repoUrl: REPO }).expect(202);
      const response = await request(app.getHttpServer()).get('/api/scan/scan-1').expect(200);
      expect(response.body).toMatchObject({
        id: 'scan-1',
        repoUrl: REPO,
        status: ScanStatus.Queued,
        criticalVulnerabilities: null,
        nextCursor: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('GET /api/scan/:id returns paginated criticals once Finished', async () => {
      await request(app.getHttpServer()).post('/api/scan').send({ repoUrl: REPO }).expect(202);
      clock.advance(5000);
      await runScan('scan-1', [critical('CVE-1'), critical('CVE-2'), critical('CVE-3')]);

      const first = await request(app.getHttpServer())
        .get('/api/scan/scan-1')
        .query({ limit: 2 })
        .expect(200);
      expect(first.body).toMatchObject({
        status: ScanStatus.Finished,
        criticalCount: 3,
        finishedAt: '2026-01-01T00:00:05.000Z',
        nextCursor: '2',
      });
      expect(first.body).toHaveProperty('criticalVulnerabilities.length', 2);

      const second = await request(app.getHttpServer())
        .get('/api/scan/scan-1')
        .query({ limit: 2, cursor: '2' })
        .expect(200);
      expect(second.body).toMatchObject({
        nextCursor: null,
        criticalVulnerabilities: [{ vulnerabilityId: 'CVE-3', severity: 'CRITICAL' }],
      });
    });

    it('GET /api/scan/:id rejects an invalid limit with 400', async () => {
      await request(app.getHttpServer()).get('/api/scan/scan-1').query({ limit: 0 }).expect(400);
    });

    it('GET /health reports liveness', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);
      expect(response.body).toMatchObject({ status: 'ok' });
    });
  });

  describe('GraphQL', () => {
    async function gql(query: string, variables: Record<string, unknown> = {}) {
      return request(app.getHttpServer()).post('/graphql').send({ query, variables }).expect(200);
    }

    it('startScan mutation queues a scan', async () => {
      const response = await gql(
        'mutation Start($url: String!) { startScan(repoUrl: $url) { scanId status } }',
        { url: REPO },
      );
      expect(response.body).toEqual({
        data: { startScan: { scanId: 'scan-1', status: 'Queued' } },
      });
      expect(app.get<RecordingScanJobQueue>(SCAN_JOB_QUEUE).jobs).toHaveLength(1);
    });

    it('startScan maps an invalid URL to a coded error', async () => {
      const response = await gql('mutation { startScan(repoUrl: "nope") { scanId } }');
      expect(response.body).toMatchObject({
        data: null,
        errors: [{ extensions: { code: 'INVALID_REPO_URL', status: 400 } }],
      });
    });

    it('scan query returns criticals of a finished scan', async () => {
      await gql('mutation { startScan(repoUrl: "https://github.com/OWASP/NodeGoat") { scanId } }');
      await runScan('scan-1', [critical('CVE-1'), critical('CVE-2')]);

      const response = await gql(
        `query Get($id: ID!) {
          scan(id: $id, first: 1) {
            id status criticalCount createdAt nextCursor
            criticalVulnerabilities { vulnerabilityId pkgName severity fixedVersion target }
          }
        }`,
        { id: 'scan-1' },
      );
      expect(response.body).toEqual({
        data: {
          scan: {
            id: 'scan-1',
            status: 'Finished',
            criticalCount: 2,
            createdAt: '2026-01-01T00:00:00.000Z',
            nextCursor: '1',
            criticalVulnerabilities: [
              {
                vulnerabilityId: 'CVE-1',
                pkgName: 'lodash',
                severity: 'CRITICAL',
                fixedVersion: '4.17.21',
                target: 'package-lock.json',
              },
            ],
          },
        },
      });
    });

    it('scan query maps an unknown id to SCAN_NOT_FOUND', async () => {
      const response = await gql('{ scan(id: "missing") { id } }');
      expect(response.body).toMatchObject({
        data: { scan: null },
        errors: [{ extensions: { code: 'SCAN_NOT_FOUND', status: 404 } }],
      });
    });
  });
});
