import { RecordingScanJobQueue } from '@code-guardian/core/testing';
import { BullMqScanJobQueue, createScanQueue, type ScanQueue } from '@code-guardian/infrastructure';
import { SCAN_JOB_QUEUE } from '@code-guardian/nest-common';
import {
  Global,
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

const SCAN_QUEUE_HANDLE = Symbol.for('code-guardian:ScanQueueHandle');

/** Closes the BullMQ queue and its Redis connection on shutdown. */
class ScanQueueLifecycle implements OnApplicationShutdown {
  constructor(@Inject(SCAN_QUEUE_HANDLE) private readonly queue: ScanQueue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * Job queue producer.
 *  - `bullmq()`: BullMQ on Redis (REDIS_URL). Jobs are deduplicated by scanId.
 *  - `inMemory()`: records jobs without running them (tests, demo mode).
 */
@Global()
@Module({})
export class QueueModule {
  static bullmq(): DynamicModule {
    return {
      module: QueueModule,
      providers: [
        {
          provide: SCAN_QUEUE_HANDLE,
          useFactory: (config: ConfigService): ScanQueue =>
            createScanQueue(
              // The producer must fail fast when Redis is down, so the API can answer 503
              // instead of hanging: no offline queue and bounded retries per command.
              new Redis(config.getOrThrow<string>('REDIS_URL'), {
                enableOfflineQueue: false,
                maxRetriesPerRequest: 1,
              }),
            ),
          inject: [ConfigService],
        },
        {
          provide: SCAN_JOB_QUEUE,
          useFactory: (queue: ScanQueue) => new BullMqScanJobQueue(queue),
          inject: [SCAN_QUEUE_HANDLE],
        },
        ScanQueueLifecycle,
      ],
      exports: [SCAN_JOB_QUEUE],
    };
  }

  static inMemory(): DynamicModule {
    return {
      module: QueueModule,
      providers: [{ provide: SCAN_JOB_QUEUE, useFactory: () => new RecordingScanJobQueue() }],
      exports: [SCAN_JOB_QUEUE],
    };
  }
}
