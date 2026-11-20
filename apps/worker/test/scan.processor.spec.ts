import {
  CloneFailedError,
  ExecuteScanCommand,
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
import { SilentLogger } from '@code-guardian/core/testing';
import { WORKER_CONCURRENCY } from '../src/scan/scan-queue';
import { LOGGER } from '../src/shared/port.tokens';
import { ScanProcessor } from '../src/scan/scan.processor';

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

function job(data: unknown, attemptsMade = 0, attempts: number | null = 3): Job {
  const opts = attempts === null ? {} : { attempts };
  return { id: 'job-1', data, attemptsMade, opts } as unknown as Job;
}

describe('ScanProcessor', () => {
  let processor: ScanProcessor;
  let handler: FakeExecuteScanHandler;
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
        { provide: WORKER_CONCURRENCY, useValue: 4 },
        { provide: LOGGER, useValue: new SilentLogger() },
      ],
    }).compile();
    await moduleRef.init();
    processor = moduleRef.get(ScanProcessor);
    handler = moduleRef.get(FakeExecuteScanHandler);
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
});
