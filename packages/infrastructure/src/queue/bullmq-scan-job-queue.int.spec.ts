import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { describeWithDocker } from '../../test/docker';
import {
  BullMqScanJobQueue,
  createScanQueue,
  DEFAULT_SCAN_JOB_OPTIONS,
  EnqueueTimeoutError,
  SCAN_JOB_NAME,
  SCAN_QUEUE,
  type ScanQueue,
} from './scan-queue';

describeWithDocker('BullMqScanJobQueue (Redis)', () => {
  jest.setTimeout(120_000);

  let container: StartedRedisContainer;
  let queue: ScanQueue;
  let adapter: BullMqScanJobQueue;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    queue = createScanQueue({ host: container.getHost(), port: container.getPort() });
    adapter = new BullMqScanJobQueue(queue);
  });

  afterAll(async () => {
    await queue.close();
    await container.stop();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  it('enqueues a job keyed by scan id with the default retry policy', async () => {
    await adapter.enqueue({ scanId: 'scan-1' });

    const job = await queue.getJob('scan-1');
    expect(queue.name).toBe(SCAN_QUEUE);
    expect(job?.name).toBe(SCAN_JOB_NAME);
    expect(job?.data).toEqual({ scanId: 'scan-1' });
    expect(job?.opts.attempts).toBe(DEFAULT_SCAN_JOB_OPTIONS.attempts);
    expect(job?.opts.backoff).toEqual(DEFAULT_SCAN_JOB_OPTIONS.backoff);
  });

  it('deduplicates repeated enqueues of the same scan', async () => {
    await adapter.enqueue({ scanId: 'scan-2' });
    await adapter.enqueue({ scanId: 'scan-2' });
    expect(await queue.getJobCountByTypes('waiting')).toBe(1);
  });

  it('fails fast instead of hanging when Redis is unreachable', async () => {
    const deadQueue = createScanQueue({
      host: '127.0.0.1',
      port: 1,
      // Keep reconnecting, as a production client would: only the adapter's timeout ends the wait.
      retryStrategy: () => 200,
    });
    deadQueue.on('error', () => undefined);
    try {
      const started = Date.now();
      await expect(
        new BullMqScanJobQueue(deadQueue, { enqueueTimeoutMs: 300 }).enqueue({ scanId: 'x' }),
      ).rejects.toMatchObject({ name: 'EnqueueTimeoutError' });
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await deadQueue.close().catch(() => undefined);
    }
  });

  it('exposes a typed timeout error', () => {
    expect(new EnqueueTimeoutError(5)).toMatchObject({ name: 'EnqueueTimeoutError', timeoutMs: 5 });
  });
});
