import {
  ExecuteScanCommand,
  ExecuteScanHandler,
  FailScanCommand,
  FailScanHandler,
  ReapStuckScansCommand,
  ReapStuckScansHandler,
  type Clock,
  type IdGenerator,
  type Logger,
  type ReaperConfig,
  type ScanJobQueue,
  type ReportParser,
  type RepositoryCloner,
  type ScanPipelineConfig,
  type ScanRepository,
  type SecurityScanner,
  type VulnerabilityRepository,
  type WorkspaceProvider,
} from '@code-guardian/core';
import { BullMqScanJobQueue, type ScanQueue } from '@code-guardian/infrastructure';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type WorkerEnv } from '../config/env.schema';
import { bindCommandHandler } from '@code-guardian/nest-common';
import { REAPER_INTERVAL_MS, ScanReaper } from './scan-reaper';
import {
  CLOCK,
  ID_GENERATOR,
  LOGGER,
  REPORT_PARSER,
  REPOSITORY_CLONER,
  SCAN_JOB_QUEUE,
  SCAN_PIPELINE_CONFIG,
  SCAN_REPOSITORY,
  SECURITY_SCANNER,
  VULNERABILITY_REPOSITORY,
  WORKSPACE_PROVIDER,
} from '@code-guardian/nest-common';
import { SCAN_QUEUE_NAME, WORKER_CONCURRENCY } from './scan-queue';
import { ScanProcessor } from './scan.processor';

/**
 * The scan job consumer. Needs BullModule.forRoot, CqrsModule.forRoot, ConfigModule and
 * the port adapters from the root, so it composes into a single-process entrypoint too.
 */
@Module({
  // registerQueue also loads @nestjs/bullmq's explorer, which creates the Worker for @Processor.
  imports: [BullModule.registerQueue({ name: SCAN_QUEUE_NAME })],
  providers: [
    {
      provide: SCAN_PIPELINE_CONFIG,
      useFactory: (config: ConfigService<WorkerEnv, true>): ScanPipelineConfig => ({
        cloneTimeoutMs: config.get('CLONE_TIMEOUT_MS', { infer: true }),
        scanTimeoutMs: config.get('SCAN_TIMEOUT_MS', { infer: true }),
        parseTimeoutMs: config.get('PARSE_TIMEOUT_MS', { infer: true }),
        batchSize: config.get('BATCH_SIZE', { infer: true }),
      }),
      inject: [ConfigService],
    },
    {
      // Read side of the queue (job states) for the reaper and stalled-job handling.
      provide: SCAN_JOB_QUEUE,
      useFactory: (queue: ScanQueue): ScanJobQueue => new BullMqScanJobQueue(queue),
      inject: [getQueueToken(SCAN_QUEUE_NAME)],
    },
    {
      provide: REAPER_INTERVAL_MS,
      useFactory: (config: ConfigService<WorkerEnv, true>): number =>
        config.get('REAPER_INTERVAL_MS', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: WORKER_CONCURRENCY,
      useFactory: (config: ConfigService<WorkerEnv, true>): number =>
        config.get('WORKER_CONCURRENCY', { infer: true }),
      inject: [ConfigService],
    },
    {
      provide: ExecuteScanHandler,
      useFactory: (
        scans: ScanRepository,
        vulnerabilities: VulnerabilityRepository,
        workspaces: WorkspaceProvider,
        cloner: RepositoryCloner,
        scanner: SecurityScanner,
        parser: ReportParser,
        ids: IdGenerator,
        clock: Clock,
        logger: Logger,
        config: ScanPipelineConfig,
      ) =>
        new ExecuteScanHandler(
          scans,
          vulnerabilities,
          workspaces,
          cloner,
          scanner,
          parser,
          ids,
          clock,
          logger,
          config,
        ),
      inject: [
        SCAN_REPOSITORY,
        VULNERABILITY_REPOSITORY,
        WORKSPACE_PROVIDER,
        REPOSITORY_CLONER,
        SECURITY_SCANNER,
        REPORT_PARSER,
        ID_GENERATOR,
        CLOCK,
        LOGGER,
        SCAN_PIPELINE_CONFIG,
      ],
    },
    {
      provide: FailScanHandler,
      useFactory: (
        scans: ScanRepository,
        vulnerabilities: VulnerabilityRepository,
        clock: Clock,
        logger: Logger,
      ) => new FailScanHandler(scans, vulnerabilities, clock, logger),
      inject: [SCAN_REPOSITORY, VULNERABILITY_REPOSITORY, CLOCK, LOGGER],
    },
    {
      provide: ReapStuckScansHandler,
      useFactory: (
        scans: ScanRepository,
        queue: ScanJobQueue,
        failScan: FailScanHandler,
        clock: Clock,
        logger: Logger,
        config: ConfigService<WorkerEnv, true>,
      ) => {
        // Never reap an attempt that may still be inside its own timeouts.
        const reaper: ReaperConfig = {
          queuedGraceMs: config.get('QUEUED_GRACE_MS', { infer: true }),
          scanningDeadlineMs:
            config.get('CLONE_TIMEOUT_MS', { infer: true }) +
            config.get('SCAN_TIMEOUT_MS', { infer: true }) +
            config.get('PARSE_TIMEOUT_MS', { infer: true }) +
            5 * 60_000,
        };
        return new ReapStuckScansHandler(scans, queue, failScan, clock, logger, reaper);
      },
      inject: [SCAN_REPOSITORY, SCAN_JOB_QUEUE, FailScanHandler, CLOCK, LOGGER, ConfigService],
    },
    bindCommandHandler(ExecuteScanCommand, ExecuteScanHandler),
    bindCommandHandler(FailScanCommand, FailScanHandler),
    bindCommandHandler(ReapStuckScansCommand, ReapStuckScansHandler),
    ScanProcessor,
    ScanReaper,
  ],
})
export class ScanWorkerModule {}
