import {
  CloneFailedError,
  ExecuteScanCommand,
  ExecuteScanHandler,
  GetScanHandler,
  GetScanQuery,
  InsufficientStorageError,
  InvalidRepoUrlError,
  QueueUnavailableError,
  ReportParseFailedError,
  ScanNotFoundError,
  ScanStatus,
  ScannerFailedError,
  Severity,
  StartScanCommand,
  StartScanHandler,
  type RepositoryCloner,
  type ReportParseOptions,
  type ReportParser,
  type ScanWorkspace,
  type SecurityScanner,
  type Vulnerability,
  type WorkspaceProvider,
} from '../src';
import {
  FixedClock,
  InMemoryScanRepository,
  InMemoryVulnerabilityRepository,
  RecordingScanJobQueue,
  SequentialIdGenerator,
  SilentLogger,
} from '../src/testing';

const REPO = 'https://github.com/OWASP/NodeGoat';

function vuln(id: string, severity: Severity = Severity.Critical): Vulnerability {
  return {
    vulnerabilityId: id,
    pkgName: 'lodash',
    installedVersion: '4.17.0',
    fixedVersion: '4.17.21',
    severity,
    title: null,
    primaryUrl: null,
    target: 'package-lock.json',
  };
}

class FakeWorkspaceProvider implements WorkspaceProvider {
  disposed = 0;
  created = 0;
  failWith: Error | null = null;

  create(scanId: string): Promise<ScanWorkspace> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.created += 1;
    return Promise.resolve({
      sourceDir: `/tmp/${scanId}/repo`,
      reportFile: `/tmp/${scanId}/report.json`,
      dispose: () => {
        this.disposed += 1;
        return Promise.resolve();
      },
    });
  }
}

class FakeCloner implements RepositoryCloner {
  failWith: Error | null = null;
  clone(): Promise<void> {
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve();
  }
}

class FakeScanner implements SecurityScanner {
  failWith: Error | null = null;
  scan(): Promise<void> {
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve();
  }
}

/** Mimics the real parser contract: filtering by severity happens inside the stream. */
class FakeParser implements ReportParser {
  constructor(
    public findings: Vulnerability[] = [],
    public failAfter: number | null = null,
  ) {}

  async *stream(_file: string, options: ReportParseOptions): AsyncGenerator<Vulnerability> {
    let emitted = 0;
    for (const finding of this.findings) {
      if (this.failAfter !== null && emitted >= this.failAfter) {
        throw new ReportParseFailedError('Unexpected token');
      }
      await Promise.resolve();
      if (options.severities.has(finding.severity)) {
        emitted += 1;
        yield finding;
      }
    }
  }
}

function setup() {
  const scans = new InMemoryScanRepository();
  const vulns = new InMemoryVulnerabilityRepository();
  const queue = new RecordingScanJobQueue();
  const clock = new FixedClock();
  const logger = new SilentLogger();
  const workspaces = new FakeWorkspaceProvider();
  const cloner = new FakeCloner();
  const scanner = new FakeScanner();
  const parser = new FakeParser();
  const start = new StartScanHandler(scans, queue, new SequentialIdGenerator(), clock, logger);
  const execute = new ExecuteScanHandler(
    scans,
    vulns,
    workspaces,
    cloner,
    scanner,
    parser,
    clock,
    logger,
    { cloneTimeoutMs: 1_000, scanTimeoutMs: 1_000, batchSize: 2 },
  );
  const get = new GetScanHandler(scans, vulns);
  return { scans, vulns, queue, workspaces, cloner, scanner, parser, start, execute, get };
}

describe('StartScanHandler', () => {
  it('stores a Queued scan and enqueues it without waiting for the scan', async () => {
    const { start, get, queue } = setup();
    const result = await start.execute(new StartScanCommand(REPO));
    expect(result).toEqual({ scanId: 'scan-1', status: 'Queued' });
    expect(queue.jobs).toEqual([{ scanId: 'scan-1' }]);
    expect((await get.execute(new GetScanQuery('scan-1'))).status).toBe(ScanStatus.Queued);
  });

  it('rejects invalid URLs before touching storage or the queue', async () => {
    const { start, queue } = setup();
    await expect(start.execute(new StartScanCommand('https://evil.com/x/y'))).rejects.toThrow(
      InvalidRepoUrlError,
    );
    expect(queue.jobs).toHaveLength(0);
  });

  it('marks the scan Failed when the queue is unavailable', async () => {
    const { start, get, queue } = setup();
    queue.failWith = new Error('ECONNREFUSED');
    await expect(start.execute(new StartScanCommand(REPO))).rejects.toThrow(QueueUnavailableError);
    const view = await get.execute(new GetScanQuery('scan-1'));
    expect(view.status).toBe(ScanStatus.Failed);
  });
});

describe('ExecuteScanHandler', () => {
  async function queued(ctx: ReturnType<typeof setup>): Promise<string> {
    return (await ctx.start.execute(new StartScanCommand(REPO))).scanId;
  }

  it('stores only CRITICAL findings, in batches, and cleans up', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    ctx.parser.findings = [
      vuln('CVE-1'),
      vuln('CVE-2', Severity.High),
      vuln('CVE-3'),
      vuln('CVE-4'),
      vuln('CVE-5', Severity.Low),
    ];

    const result = await ctx.execute.execute(new ExecuteScanCommand(id, 1, 3));

    expect(result).toEqual({ outcome: 'finished', criticalCount: 3 });
    const view = await ctx.get.execute(new GetScanQuery(id));
    expect(view.status).toBe(ScanStatus.Finished);
    expect(view.criticalCount).toBe(3);
    expect(view.criticalVulnerabilities?.map((v) => v.vulnerabilityId)).toEqual([
      'CVE-1',
      'CVE-3',
      'CVE-4',
    ]);
    expect(ctx.workspaces.disposed).toBe(1);
  });

  it('requeues a retryable failure while attempts remain', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    ctx.scanner.failWith = new ScannerFailedError('trivy exited with 1', 1, 'db download failed');

    await expect(ctx.execute.execute(new ExecuteScanCommand(id, 1, 3))).rejects.toBeInstanceOf(
      ScannerFailedError,
    );

    const view = await ctx.get.execute(new GetScanQuery(id));
    expect(view.status).toBe(ScanStatus.Queued);
    expect(view.failureReason).toBe('trivy exited with 1');
    expect(ctx.workspaces.disposed).toBe(1);
  });

  it('fails for good on the last attempt', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    ctx.scanner.failWith = new ScannerFailedError('trivy exited with 1', 1, '');
    await expect(ctx.execute.execute(new ExecuteScanCommand(id, 3, 3))).rejects.toThrow();
    expect((await ctx.get.execute(new GetScanQuery(id))).status).toBe(ScanStatus.Failed);
  });

  it('fails immediately on a non-retryable error such as a missing repository', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    ctx.cloner.failWith = new CloneFailedError('Repository not found', false);
    await expect(ctx.execute.execute(new ExecuteScanCommand(id, 1, 3))).rejects.toThrow(
      CloneFailedError,
    );
    const view = await ctx.get.execute(new GetScanQuery(id));
    expect(view.status).toBe(ScanStatus.Failed);
    expect(view.failureReason).toBe('Repository not found');
  });

  it('drops partially stored findings when parsing fails midway', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    ctx.parser.findings = [vuln('CVE-1'), vuln('CVE-2'), vuln('CVE-3')];
    ctx.parser.failAfter = 2;
    await expect(ctx.execute.execute(new ExecuteScanCommand(id, 1, 3))).rejects.toThrow(
      ReportParseFailedError,
    );
    expect(ctx.vulns.countFor(id)).toBe(0);
    expect((await ctx.get.execute(new GetScanQuery(id))).status).toBe(ScanStatus.Failed);
  });

  it('maps a raw ENOSPC error to InsufficientStorageError', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    ctx.cloner.failWith = Object.assign(new Error('write failed'), { code: 'ENOSPC' });
    await expect(ctx.execute.execute(new ExecuteScanCommand(id, 1, 1))).rejects.toBeInstanceOf(
      InsufficientStorageError,
    );
    expect(ctx.workspaces.disposed).toBe(1);
  });

  it('fails without cleanup work when the workspace cannot be created', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    ctx.workspaces.failWith = new InsufficientStorageError('Only 10MB free');
    await expect(ctx.execute.execute(new ExecuteScanCommand(id, 1, 1))).rejects.toThrow(
      InsufficientStorageError,
    );
    expect(ctx.workspaces.disposed).toBe(0);
    expect((await ctx.get.execute(new GetScanQuery(id))).status).toBe(ScanStatus.Failed);
  });

  it('clears results of an interrupted earlier attempt before re-running', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    await ctx.vulns.appendBatch(id, [vuln('STALE-1')]);
    ctx.parser.findings = [vuln('CVE-1')];
    await ctx.execute.execute(new ExecuteScanCommand(id, 2, 3));
    const view = await ctx.get.execute(new GetScanQuery(id));
    expect(view.criticalVulnerabilities?.map((v) => v.vulnerabilityId)).toEqual(['CVE-1']);
  });

  it('skips scans that already reached a terminal state (duplicate delivery)', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    await ctx.execute.execute(new ExecuteScanCommand(id, 1, 3));
    const second = await ctx.execute.execute(new ExecuteScanCommand(id, 1, 3));
    expect(second.outcome).toBe('skipped');
    expect(ctx.workspaces.created).toBe(1);
  });

  it('throws ScanNotFoundError for unknown scans', async () => {
    const ctx = setup();
    await expect(ctx.execute.execute(new ExecuteScanCommand('nope', 1, 1))).rejects.toThrow(
      ScanNotFoundError,
    );
  });
});

describe('GetScanHandler', () => {
  it('hides results until Finished and paginates them afterwards', async () => {
    const ctx = setup();
    const { scanId } = await ctx.start.execute(new StartScanCommand(REPO));
    expect((await ctx.get.execute(new GetScanQuery(scanId))).criticalVulnerabilities).toBeNull();

    ctx.parser.findings = [vuln('A'), vuln('B'), vuln('C')];
    await ctx.execute.execute(new ExecuteScanCommand(scanId, 1, 1));

    const first = await ctx.get.execute(new GetScanQuery(scanId, 2));
    expect(first.criticalVulnerabilities?.map((v) => v.vulnerabilityId)).toEqual(['A', 'B']);
    expect(first.nextCursor).not.toBeNull();
    const second = await ctx.get.execute(new GetScanQuery(scanId, 2, first.nextCursor));
    expect(second.criticalVulnerabilities?.map((v) => v.vulnerabilityId)).toEqual(['C']);
    expect(second.nextCursor).toBeNull();
  });

  it('throws ScanNotFoundError for unknown ids', async () => {
    const { get } = setup();
    await expect(get.execute(new GetScanQuery('missing'))).rejects.toThrow(ScanNotFoundError);
  });
});
