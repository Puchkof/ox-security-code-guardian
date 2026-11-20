import { RecordingScanJobQueue } from '@code-guardian/core/testing';
import { Global, Module } from '@nestjs/common';
import { SCAN_JOB_QUEUE } from '../shared/port.tokens';

/**
 * Job queue producer.
 * TODO(infrastructure): replace the recording fake with BullMqScanJobQueue
 * (queue 'scans', jobId = scanId) from @code-guardian/infrastructure, built from REDIS_URL.
 */
@Global()
@Module({
  providers: [{ provide: SCAN_JOB_QUEUE, useFactory: () => new RecordingScanJobQueue() }],
  exports: [SCAN_JOB_QUEUE],
})
export class QueueModule {}
