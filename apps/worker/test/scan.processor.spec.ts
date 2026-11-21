import {
  CloneFailedError,
  ExecuteScanCommand,
  FailScanCommand,
  ScanOwnershipLostError,
  InvalidScanTransitionError,
  ReportParseFailedError,
  ScanNotFoundError,
  ScannerFailedError,
  type ExecuteScanResult,
} from '@code-guardian/core';
import { WorkerHost } from '@nestjs/bullmq';
import { CommandHandler, CqrsModule } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { UnrecoverableError, type Job, type Worker } from 'bullmq';
import { RecordingScanJobQueue, SilentLogger } from '@code-guardian/core/testing';
import { WORKER_CONCURRENCY } from '../src/scan/scan-queue';
import { LOGGER, SCAN_JOB_QUEUE } from '@code-guardian/nest-common';
import { STALLED_REASON, ScanProcessor } from '../src/scan/scan.processor';

/** Stands in for the core ExecuteScanHandler behind the real CommandBus. */
@CommandHandler(ExecuteScanCommand)
class FakeExecuteScanHandler {
  received: ExecuteScanCommand[] = [];
  outcome: (() => Promise<ExecuteScanResult>) | null = null;

  execute(command: ExecuteScanCommand): Promise<ExecuteScanResult> {
    this.received.push(command);
    return this.outcome
      ? this.outcome()
      : Promise.resolve({ outcome: 'finished', criticalCount: 2 });
  }
}

@CommandHandler(FailScanCommand)
class FakeFailScanHandler {
  received: FailScanCommand[] = [];

  execute(command: FailScanCommand): Promise<string> {
    this.received.push(command);
    return Promise.resolve('failed');
  }
}

function job(data: unknown, attemptsMade = 0, attempts: number | null = 3): Job {
  const opts = attempts === null ? {} : { attempts };
  return { id: 'job-1', data, attemptsMade, opts } as unknown as Job;
}

describe('ScanProcessor', () => {
  let processor: ScanProcessor;
  let handler: FakeExecuteScanHandler;
  let failScan: FakeFailScanHandler;
  let jobs: RecordingScanJobQueue;
  let worker: Pick<Worker, 'concurrency'>;

  beforeEach(async () => {
    // The real Worker is created by @nestjs/bullmq's explorer against Redis; stand in for it.
    worker = { concurrency: 1 };
    jest.spyOn(WorkerHost.prototype, 'worker', 'get').mockReturnValue(worker);

    const moduleRef = await Test.createTestingModule({
      imports: [CqrsModule.forRoot()],
      providers: [
        ScanProcessor,
        FakeExecuteScanHandler,
        FakeFailScanHandler,
        { provide: SCAN_JOB_QUEUE, useValue: (jobs = new RecordingScanJobQueue()) },
        { provide: WORKER_CONCURRENCY, useValue: 4 },
        { provide: LOGGER, useValue: new SilentLogger() },
      ],
    }).compile();
    await moduleRef.init();
    processor = moduleRef.get(ScanProcessor);
    handler = moduleRef.get(FakeExecuteScanHandler);
    failScan = moduleRef.get(FakeFailScanHandler);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('applies WORKER_CONCURRENCY to the worker on bootstrap', () => {
    expect(worker.concurrency).toBe(4);
  });

  function failWith(error: unknown): void {
    handler.outcome = () =>
      Promise.reject(error instanceof Error ? error : new Error('x', { cause: error }));
  }

  it('dispatches ExecuteScanCommand with a 1-based attempt and the max attempts', async () => {
    await expect(processor.process(job({ scanId: 'scan-1' }, 1, 3))).resolves.toEqual({
      outcome: 'finished',
      criticalCount: 2,
    });
    expect(handler.received).toEqual([new ExecuteScanCommand('scan-1', 2, 3)]);
  });

  it('defaults max attempts to 1 when the job has no retry policy', async () => {
    await processor.process(job({ scanId: 'scan-1' }, 0, null));
    expect(handler.received).toEqual([new ExecuteScanCommand('scan-1', 1, 1)]);
  });

  it('rejects a malformed payload as unrecoverable without running the use case', async () => {
    await expect(processor.process(job({ nope: true }))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(handler.received).toHaveLength(0);
  });

  it.each([
    ['retryable scanner failure', new ScannerFailedError('trivy crashed', 1, '')],
    ['retryable clone failure', new CloneFailedError('network', true)],
    ['unexpected error', new Error('boom')],
  ])('rethrows a %s unchanged so BullMQ retries it', async (_label, error) => {
    failWith(error);
    const thrown: unknown = await processor
      .process(job({ scanId: 'scan-1' }))
      .catch((e: unknown) => e);
    expect(thrown).toBe(error);
    expect(thrown).not.toBeInstanceOf(UnrecoverableError);
  });

  it.each([
    ['non-retryable clone failure', new CloneFailedError('repository not found', false)],
    ['corrupt report', new ReportParseFailedError('bad json')],
    ['missing scan', new ScanNotFoundError('scan-1')],
    ['invalid transition', new InvalidScanTransitionError('Finished', 'Scanning')],
  ])('wraps a %s in UnrecoverableError so no retries are wasted', async (_label, error) => {
    failWith(error);
    const thrown: unknown = await processor
      .process(job({ scanId: 'scan-1' }))
      .catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(UnrecoverableError);
    expect((thrown as Error).message).toContain(error.code);
    expect((thrown as Error).cause).toBe(error);
  });

  describe('when BullMQ gives up on a job', () => {
    it('fails the scan with a client-safe reason after the last attempt', async () => {
      await processor.onFailed(
        job({ scanId: 'scan-1' }, 3, 3),
        new CloneFailedError('git: could not resolve host', true),
      );
      expect(failScan.received).toEqual([
        new FailScanCommand('scan-1', 'Could not clone the repository (network or Git error)'),
      ]);
    });

    it('uses the stalled reason when BullMQ failed the job for stalling too often', async () => {
      await processor.onFailed(
        job({ scanId: 'scan-1' }, 1, 3),
        new Error('job stalled more than allowable limit'),
      );
      expect(failScan.received).toEqual([new FailScanCommand('scan-1', STALLED_REASON)]);
    });

    it('does nothing while retries remain', async () => {
      await processor.onFailed(job({ scanId: 'scan-1' }, 1, 3), new Error('flaky'));
      expect(failScan.received).toHaveLength(0);
    });

    it('never fails a scan that a newer attempt took over', async () => {
      const lost = new UnrecoverableError('SCAN_OWNERSHIP_LOST');
      lost.cause = new ScanOwnershipLostError('scan-1');
      await processor.onFailed(job({ scanId: 'scan-1' }, 1, 3), lost);
      expect(failScan.received).toHaveLength(0);
    });

    it('fails the scan when a stalled job was moved to failed (max stalls exceeded)', async () => {
      jobs.states.set('scan-9', 'failed');
      await processor.onStalled('scan-9');
      expect(failScan.received).toEqual([new FailScanCommand('scan-9', STALLED_REASON)]);
    });

    it('leaves a stalled job alone when BullMQ re-queued it', async () => {
      jobs.states.set('scan-9', 'pending');
      await processor.onStalled('scan-9');
      expect(failScan.received).toHaveLength(0);
    });
  });
});
