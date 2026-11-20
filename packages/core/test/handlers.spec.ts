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
  FailScanCommand,
  FailScanHandler,
  REAPED_REASON,
  ReapStuckScansCommand,
  ReapStuckScansHandler,
  ScanOwnershipLostError,
  UnexpectedScanError,
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
    new SequentialIdGenerator('run'),
    clock,
    logger,
    { cloneTimeoutMs: 1_000, scanTimeoutMs: 1_000, parseTimeoutMs: 1_000, batchSize: 2 },
  );
  const get = new GetScanHandler(scans, vulns);
  const fail = new FailScanHandler(scans, vulns, clock, logger);
  const reap = new ReapStuckScansHandler(scans, queue, fail, clock, logger, {
    queuedGraceMs: 60_000,
    scanningDeadlineMs: 600_000,
  });
  return {
    scans,
    vulns,
    queue,
    clock,
    workspaces,
    cloner,
    scanner,
    parser,
    start,
    execute,
    get,
    fail,
    reap,
  };
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
    expect(view.failureReason).toBe('The security scanner failed');
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
    expect(view.failureReason).toBe('Repository was not found or is not public');
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

  it('never shows findings of an interrupted earlier attempt and cleans them up', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    await ctx.vulns.appendBatch(id, 'old-run', [vuln('STALE-1')]);
    ctx.parser.findings = [vuln('CVE-1')];
    await ctx.execute.execute(new ExecuteScanCommand(id, 2, 3));
    const view = await ctx.get.execute(new GetScanQuery(id));
    expect(view.criticalVulnerabilities?.map((v) => v.vulnerabilityId)).toEqual(['CVE-1']);
    expect(ctx.vulns.countFor(id)).toBe(1);
  });

  it('stores a client-safe failure reason, never raw scanner output', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    ctx.scanner.failWith = new ScannerFailedError(
      'Trivy exited with code 1: FATAL /scans/scan-abc/repo: dial tcp trivy-server:4954',
      1,
      'stderr…',
    );
    await expect(ctx.execute.execute(new ExecuteScanCommand(id, 1, 1))).rejects.toThrow();
    const view = await ctx.get.execute(new GetScanQuery(id));
    expect(view.failureReason).toBe('The security scanner failed');
  });

  it('passes a deadline to the parser', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    const seen: (AbortSignal | undefined)[] = [];
    const original = ctx.parser.stream.bind(ctx.parser);
    ctx.parser.stream = (file, options) => {
      seen.push(options.signal);
      return original(file, options);
    };
    await ctx.execute.execute(new ExecuteScanCommand(id, 1, 1));
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it('keeps the original failure when recording it fails (database outage)', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    ctx.cloner.failWith = new CloneFailedError('Repository not found', false);
    // The start save succeeds; the failure-path save then fails.
    const save = ctx.scans.save.bind(ctx.scans);
    let calls = 0;
    ctx.scans.save = (scan) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error('database unavailable')) : save(scan);
    };
    await expect(ctx.execute.execute(new ExecuteScanCommand(id, 1, 1))).rejects.toBeInstanceOf(
      CloneFailedError,
    );
    expect(ctx.workspaces.disposed).toBe(1);
  });

  it('records a failure when the very first save fails', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    ctx.scans.failNextSaves = 1;
    await expect(ctx.execute.execute(new ExecuteScanCommand(id, 1, 1))).rejects.toBeInstanceOf(
      UnexpectedScanError,
    );
    expect((await ctx.get.execute(new GetScanQuery(id))).status).toBe(ScanStatus.Failed);
  });

  it('stops without touching the scan when a newer attempt took over', async () => {
    const ctx = setup();
    const id = await queued(ctx);
    // Simulate a redelivered attempt that starts while this one is scanning.
    ctx.scanner.scan = async () => {
      const other = await ctx.scans.findById(id);
      other!.start('other-run', new Date());
      await ctx.scans.save(other!);
    };
    ctx.parser.findings = [vuln('CVE-1')];

    await expect(ctx.execute.execute(new ExecuteScanCommand(id, 1, 3))).rejects.toBeInstanceOf(
      ScanOwnershipLostError,
    );
    const view = await ctx.get.execute(new GetScanQuery(id));
    expect(view.status).toBe(ScanStatus.Scanning);
    expect(ctx.workspaces.disposed).toBe(1);
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

describe('StartScanHandler under races', () => {
  it('reports success when enqueue timed out but a worker already owns the scan', async () => {
    const ctx = setup();
    ctx.queue.enqueue = async (job) => {
      // The add landed and a worker started before the timeout surfaced.
      const scan = await ctx.scans.findById(job.scanId);
      scan!.start('run-x', new Date());
      await ctx.scans.save(scan!);
      throw new Error('Enqueue did not complete within 5000ms');
    };
    const result = await ctx.start.execute(new StartScanCommand(REPO));
    expect(result.status).toBe('Queued');
    expect((await ctx.get.execute(new GetScanQuery(result.scanId))).status).toBe(
      ScanStatus.Scanning,
    );
  });
});

describe('FailScanHandler', () => {
  it('fails a non-terminal scan and is a no-op afterwards', async () => {
    const ctx = setup();
    const { scanId } = await ctx.start.execute(new StartScanCommand(REPO));
    expect(await ctx.fail.execute(new FailScanCommand(scanId, 'Job stalled'))).toBe('failed');
    expect(await ctx.fail.execute(new FailScanCommand(scanId, 'again'))).toBe('already-terminal');
    const view = await ctx.get.execute(new GetScanQuery(scanId));
    expect(view).toMatchObject({ status: ScanStatus.Failed, failureReason: 'Job stalled' });
  });

  it('does not override a finished scan', async () => {
    const ctx = setup();
    const { scanId } = await ctx.start.execute(new StartScanCommand(REPO));
    await ctx.execute.execute(new ExecuteScanCommand(scanId, 1, 1));
    expect(await ctx.fail.execute(new FailScanCommand(scanId, 'late'))).toBe('already-terminal');
    expect((await ctx.get.execute(new GetScanQuery(scanId))).status).toBe(ScanStatus.Finished);
  });

  it('returns not-found for unknown scans', async () => {
    const ctx = setup();
    expect(await ctx.fail.execute(new FailScanCommand('nope', 'x'))).toBe('not-found');
  });
});

describe('ReapStuckScansHandler', () => {
  async function scanningScan(ctx: ReturnType<typeof setup>): Promise<string> {
    const { scanId } = await ctx.start.execute(new StartScanCommand(REPO));
    const scan = await ctx.scans.findById(scanId);
    scan!.start('run-1', ctx.clock.now());
    await ctx.scans.save(scan!);
    return scanId;
  }

  it('fails a Scanning scan whose job BullMQ already failed (stalled too often)', async () => {
    const ctx = setup();
    const id = await scanningScan(ctx);
    ctx.queue.states.set(id, 'failed');
    ctx.clock.advance(61_000);
    expect(await ctx.reap.execute(new ReapStuckScansCommand())).toEqual({
      inspected: 1,
      failed: 1,
    });
    expect((await ctx.get.execute(new GetScanQuery(id))).failureReason).toBe(REAPED_REASON);
  });

  it('leaves a Scanning scan alone while its attempt may still be within its timeouts', async () => {
    const ctx = setup();
    const id = await scanningScan(ctx);
    ctx.queue.states.set(id, 'active');
    ctx.clock.advance(120_000);
    await ctx.reap.execute(new ReapStuckScansCommand());
    expect((await ctx.get.execute(new GetScanQuery(id))).status).toBe(ScanStatus.Scanning);
  });

  it('fails a Scanning scan past the hard deadline even if the job looks active', async () => {
    const ctx = setup();
    const id = await scanningScan(ctx);
    ctx.queue.states.set(id, 'active');
    ctx.clock.advance(600_001);
    await ctx.reap.execute(new ReapStuckScansCommand());
    expect((await ctx.get.execute(new GetScanQuery(id))).status).toBe(ScanStatus.Failed);
  });

  it('fails a Queued scan that has no job (crash between save and enqueue)', async () => {
    const ctx = setup();
    const { scanId } = await ctx.start.execute(new StartScanCommand(REPO));
    ctx.queue.states.set(scanId, 'missing');
    ctx.clock.advance(61_000);
    await ctx.reap.execute(new ReapStuckScansCommand());
    expect((await ctx.get.execute(new GetScanQuery(scanId))).status).toBe(ScanStatus.Failed);
  });

  it('keeps old Queued scans whose job is still waiting (backlog)', async () => {
    const ctx = setup();
    const { scanId } = await ctx.start.execute(new StartScanCommand(REPO));
    ctx.clock.advance(3_600_000);
    await ctx.reap.execute(new ReapStuckScansCommand());
    expect((await ctx.get.execute(new GetScanQuery(scanId))).status).toBe(ScanStatus.Queued);
  });
});
